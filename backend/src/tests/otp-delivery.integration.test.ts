import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env';
import { UserModel } from '../modules/auth/user.model';
import { SessionChallengeModel } from '../modules/auth/session-challenge.model';
import { authService } from '../modules/auth/auth.service';
import { OTP_DELIVERY_TIMEOUT_MS, sendOtpViaTelegram } from '../modules/auth/otp-telegram';

before(async () => {
  assert.match(process.env.MONGODB_URL ?? '', /^mongodb:\/\/127\.0\.0\.1:\d+\/hisvex_integration\?/);
  await mongoose.connect(process.env.MONGODB_URL!);
  await Promise.all([UserModel.init(), SessionChallengeModel.init()]);
});
after(async () => { await mongoose.disconnect(); });

// No real Telegram traffic or account credentials. Restore every process-wide
// mock so each subsequent test exercises the actual application policy.
async function withTelegramMock(work: () => Promise<void>, fetchMock: typeof fetch,
  tokens: { reportToken?: string; otpToken?: string } = { reportToken: 'test-only-token' }) {
  const originalToken = env.BOT_TOKEN;
  const originalOtpToken = env.OTP_TELEGRAM_BOT_TOKEN;
  const originalFetch = globalThis.fetch;
  env.BOT_TOKEN = tokens.reportToken;
  env.OTP_TELEGRAM_BOT_TOKEN = tokens.otpToken;
  globalThis.fetch = fetchMock;
  try { await work(); } finally {
    env.BOT_TOKEN = originalToken;
    env.OTP_TELEGRAM_BOT_TOKEN = originalOtpToken;
    globalThis.fetch = originalFetch;
  }
}

test('OTP uses the interactive bot token while the reporting token stays unchanged', async () => {
  const u = await UserModel.create({ username: randomUUID(), password: 'test-password-123',
    role: 'admin', isActive: true, activeSessionId: randomUUID(), activeSessionLastSeenAt: new Date(), telegramId: randomUUID() });
  let sends = 0;
  await withTelegramMock(async () => {
    const challenge = await authService.login(u.username, 'test-password-123', 'new-device');
    assert.ok('requiresVerification' in challenge && challenge.requiresVerification);
    assert.equal(env.BOT_TOKEN, 'report-bot-test-token');
    assert.equal(sends, 1);
    assert.equal((await UserModel.findById(u._id))!.activeSessionId, u.activeSessionId);
  }, async (url, options) => {
    sends++;
    assert.equal(url, 'https://api.telegram.org/botinteractive-bot-test-token/sendMessage');
    const payload = JSON.parse(String(options?.body));
    assert.equal(payload.chat_id, u.telegramId);
    return new Response('{"ok":true}');
  }, { reportToken: 'report-bot-test-token', otpToken: 'interactive-bot-test-token' });
});

test('dedicated OTP token works without a reporting token; older single-bot deployments still work', async () => {
  for (const tokens of [
    { otpToken: 'interactive-bot-test-token' },
    { reportToken: 'legacy-bot-test-token' },
  ]) {
    await withTelegramMock(async () => {
      assert.equal(await sendOtpViaTelegram('test-chat', '123456'), true);
    }, async (url) => {
      assert.equal(url, `https://api.telegram.org/bot${tokens.otpToken ?? tokens.reportToken}/sendMessage`);
      return new Response('{"ok":true}');
    }, tokens);
  }
});

test('delivery diagnostics classify Telegram failures without exposing tokens, chat ids or OTPs', async () => {
  const logs: string[] = [];
  const originalError = console.error;
  console.error = (...args) => { logs.push(args.join(' ')); };
  const token = 'private-test-token', chat = 'private-test-chat', otp = '654321';
  try {
    for (const [status, description, reason] of [
      [401, 'Unauthorized', 'BOT_TOKEN_INVALID'],
      [400, 'Bad Request: chat not found', 'CHAT_NOT_FOUND'],
      [403, 'Forbidden: bot was blocked by the user', 'BOT_BLOCKED'],
      [403, 'Forbidden', 'TELEGRAM_FORBIDDEN'],
      [429, 'Too Many Requests', 'TELEGRAM_RATE_LIMITED'],
      [500, 'Unexpected error', 'TELEGRAM_REJECTED'],
    ] as const) {
      let sends = 0;
      await withTelegramMock(async () => {
        assert.equal(await sendOtpViaTelegram(chat, otp), false);
        assert.equal(sends, 1, 'failed OTP sends must not retry through the reporting bot');
        assert.match(logs.at(-1)!, new RegExp(reason));
      }, async () => {
        sends++;
        return new Response(JSON.stringify({ ok: false, error_code: status,
          description: `${description}; ${token}; ${chat}; ${otp}` }), { status });
      }, { reportToken: 'report-bot-test-token', otpToken: token });
    }
    await withTelegramMock(async () => {
      assert.equal(await sendOtpViaTelegram(chat, otp), false);
    }, async () => { throw new Error(`https://api.telegram.org/bot${token}/sendMessage ${chat} ${otp}`); },
    { otpToken: token });
    assert.match(logs.at(-1)!, /failed or timed out/);
    let calls = 0;
    await withTelegramMock(async () => {
      assert.equal(await sendOtpViaTelegram(chat, otp), false);
    }, async () => { calls++; throw new Error('must not call Telegram'); }, {});
    assert.equal(calls, 0);
    assert.match(logs.at(-1)!, /BOT_TOKEN_MISSING/);
    const output = logs.join('\n');
    for (const secret of [token, chat, otp, 'report-bot-test-token']) assert.equal(output.includes(secret), false);
  } finally { console.error = originalError; }
});

test('OTP requires a Telegram acknowledgement and rejects API errors or malformed bodies', async () => {
  for (const [status, body, expected] of [
    [200, '{"ok":true}', true], [200, '{"ok":false}', false],
    [403, '{"ok":false}', false], [200, 'invalid json', false],
  ] as const) {
    await withTelegramMock(async () => {
      assert.equal(await sendOtpViaTelegram('test-chat', '123456'), expected);
    }, async (_url, options) => {
      assert.ok(options?.signal); assert.equal(options?.method, 'POST');
      return new Response(body, { status });
    });
  }
});

test('a stalled Telegram send is bounded, cleans its challenge and leaves the active session intact', async () => {
  const u = await UserModel.create({ username: randomUUID(), password: 'test-password-123',
    role: 'admin', isActive: true, activeSessionId: randomUUID(), activeSessionLastSeenAt: new Date(), telegramId: randomUUID() });
  const originalTimeout = AbortSignal.timeout;
  AbortSignal.timeout = milliseconds => {
    assert.equal(milliseconds, OTP_DELIVERY_TIMEOUT_MS);
    assert.equal(milliseconds, 8_000);
    return originalTimeout(20);
  };
  try {
    await withTelegramMock(async () => {
      await assert.rejects(authService.login(u.username, 'test-password-123', 'new-device'),
        (error: any) => error.statusCode === 503 && error.code === 'OTP_DELIVERY_FAILED');
      assert.equal(await SessionChallengeModel.countDocuments({ userId: u._id.toString() }), 0);
      assert.equal((await UserModel.findById(u._id))!.activeSessionId, u.activeSessionId);
    }, async (_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), { once: true });
    }));
  } finally { AbortSignal.timeout = originalTimeout; }
});

test('ordinary login returns the delivered OTP challenge while procurement login does not send OTP or replace the session', async () => {
  const u = await UserModel.create({ username: randomUUID(), password: 'test-password-123',
    role: 'admin', isActive: true, activeSessionId: randomUUID(), activeSessionLastSeenAt: new Date(), telegramId: randomUUID() });
  let sends = 0;
  await withTelegramMock(async () => {
    const challenge = await authService.login(u.username, 'test-password-123', 'new-device');
    assert.ok('requiresVerification' in challenge && challenge.requiresVerification);
    assert.equal(sends, 1);
    const agent = await authService.loginAsProcurementAgent(u.username, 'test-password-123');
    assert.equal(agent.user.scope, 'procurement'); assert.equal(sends, 1);
    assert.equal((await UserModel.findById(u._id))!.activeSessionId, u.activeSessionId);
    assert.equal(await SessionChallengeModel.countDocuments({ userId: u._id.toString(), consumed: false }), 1);
  }, async () => { sends++; return new Response('{"ok":true}'); });
});
