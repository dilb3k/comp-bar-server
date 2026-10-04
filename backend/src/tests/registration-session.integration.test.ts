import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { env } from '../config/env';
import { createApp } from '../app';
import { UserModel } from '../modules/auth/user.model';
import { authService } from '../modules/auth/auth.service';
import { authRepository } from '../modules/auth/auth.repository';
import { phoneVerificationRequired, SESSION_ACTIVITY_TTL_MS, signAccessToken, verifyAccessToken } from '../modules/auth/auth.utils';
import { subscriptionService } from '../modules/subscriptions/subscription.service';
import { SubscriptionModel } from '../modules/subscriptions/subscription.model';
import { OwnerWriteVersion } from '../lib/transaction';
import { paymentService } from '../modules/payments/payment.service';

let server: ReturnType<ReturnType<typeof createApp>['listen']>;
let base: string;
let phoneSequence = 8000000;
const signup = () => ({ username: `signup-${randomUUID()}`, password: 'local-password-123', phone_number: `99893${++phoneSequence}`, businessDayStartHour: 6, deviceId: 'local-device' });
before(async () => {
  assert.match(process.env.MONGODB_URL ?? '', /^mongodb:\/\/127\.0\.0\.1:\d+\/hisvex_integration\?/);
  await mongoose.connect(process.env.MONGODB_URL!);
  await Promise.all([UserModel, SubscriptionModel, OwnerWriteVersion].map(model => model.init()));
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await mongoose.disconnect();
});
async function request(path: string, body?: unknown, token?: string) {
  const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  return { status: response.status, body: await response.json() as any };
}
async function enabled<T>(work: () => Promise<T>) {
  const original = env.ALLOW_PUBLIC_REGISTER;
  env.ALLOW_PUBLIC_REGISTER = true;
  try { return await work(); } finally { env.ALLOW_PUBLIC_REGISTER = original; }
}
async function session(extra: Record<string, unknown> = {}) {
  return UserModel.create({ ...signup(), role: 'admin', isActive: true,
    activeSessionId: randomUUID(), activeSessionLastSeenAt: new Date(), ...extra });
}

test('disabled signup has a stable 403 contract and performs no account lookup', async () => {
  const original = authRepository.findByUsername;
  authRepository.findByUsername = async () => { throw Error('must not query DB'); };
  try {
    const response = await request('/auth/register', signup());
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'PUBLIC_REGISTRATION_DISABLED');
  } finally { authRepository.findByUsername = original; }
});
test('malformed and oversized auth JSON returns a safe client error', async () => {
  for (const [body, status, code] of [['{"password":"private-test', 400, 'INVALID_JSON'], [JSON.stringify({ password: 'private-test', extra: 'x'.repeat(17000) }), 413, 'PAYLOAD_TOO_LARGE']] as const) {
    const response = await fetch(base + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    assert.equal(response.status, status);
    const payload = await response.json() as any;
    assert.equal(payload.error.code, code);
    assert.equal(JSON.stringify(payload).includes('private-test'), false);
  }
});
test('signup creates only an ordinary tenant, a full seven-day trial and a current session', async () => enabled(async () => {
  const input = signup();
  const original = authRepository.findSuperAdmin;
  authRepository.findSuperAdmin = async () => { throw Error('signup must never bootstrap a platform admin'); };
  try {
    const response = await request('/auth/register', { ...input, role: 'superAdmin', isPayed: true, telegramId: 'forged' });
    assert.equal(response.status, 200);
    const { token, refreshToken, user } = response.body.data;
    assert.equal(user.role, 'admin');
    assert.equal(user.telegramId, null);
    assert.equal(user.tier, 'bor');
    assert.ok(refreshToken);
    for (const field of ['password', 'activeSessionId', 'activeSessionLastSeenAt', 'activeSessionExpiresAt']) assert.equal(field in user, false);
    const stored = await UserModel.findById(user.id);
    assert.equal(stored!.activeSessionId, verifyAccessToken(token).sessionId);
    assert.equal(phoneVerificationRequired(stored!), true);
    const sub = await SubscriptionModel.findOne({ userId: user.id });
    assert.equal(sub!.endDate.getTime() - sub!.startDate.getTime(), 7 * 24 * 60 * 60 * 1000);
    assert.equal((await request('/auth/admins', undefined, token)).status, 403);
    assert.equal((await request('/auth/session/heartbeat', {}, token)).status, 200);
  } finally { authRepository.findSuperAdmin = original; }
}));
test('signup requires a usable phone and rejects missing, short or oversized credentials', async () => enabled(async () => {
  for (const changes of [{ phone_number: undefined }, { phone_number: '+998' }, { username: 'x'.repeat(65) }, { password: '🔐'.repeat(19) }]) {
    assert.equal((await request('/auth/register', { ...signup(), ...changes })).status, 422);
  }
}));
test('concurrent signup for one phone creates one account and one trial', async () => enabled(async () => {
  const first = signup();
  const second = { ...signup(), phone_number: `+${first.phone_number.slice(0, 3)} ${first.phone_number.slice(3)}` };
  const responses = await Promise.all([request('/auth/register', first), request('/auth/register', second)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  const users = await UserModel.find({ phoneDigits: first.phone_number });
  assert.equal(users.length, 1);
  assert.equal(await SubscriptionModel.countDocuments({ userId: users[0]._id.toString() }), 1);
}));
test('a failed trial rolls back the whole signup and retry succeeds', async () => enabled(async () => {
  const input = signup();
  const original = subscriptionService.createTrialSubscription;
  subscriptionService.createTrialSubscription = async () => { throw Error('injected trial failure'); };
  try { await assert.rejects(authService.register(input), /injected trial failure/); }
  finally { subscriptionService.createTrialSubscription = original; }
  assert.equal(await UserModel.countDocuments({ username: input.username }), 0);
  assert.equal((await authService.register(input)).user.role, 'admin');
}));
test('logout revokes old credentials and a subsequent login needs no phantom OTP', async () => {
  const u = await session({ telegramId: null });
  const oldToken = signAccessToken({ userId: u._id.toString(), username: u.username, role: 'admin', isPayed: false, tier: 'tekin', phone_number: u.phone_number, sessionId: u.activeSessionId! });
  await authService.logout(u._id.toString(), u.activeSessionId!);
  assert.equal(phoneVerificationRequired((await UserModel.findById(u._id))!), false);
  assert.equal((await request('/auth/session/heartbeat', {}, oldToken)).status, 401);
  const next = await authService.login(u.username, 'local-password-123', 'new-device');
  assert.ok('token' in next);
});
test('missing activity, inactivity and explicit expiry do not produce a false active-session challenge', async () => {
  for (const extra of [
    { activeSessionLastSeenAt: null, lastActionAt: null },
    { activeSessionLastSeenAt: null, lastActionAt: new Date() },
    { activeSessionLastSeenAt: new Date(Date.now() - SESSION_ACTIVITY_TTL_MS - 1000) },
    { activeSessionExpiresAt: new Date(Date.now() - 1000) },
  ]) {
    const u = await session({ telegramId: null, ...extra });
    assert.ok('token' in await authService.login(u.username, 'local-password-123', 'new-device'));
  }
  const live = await session({ telegramId: null });
  await assert.rejects(authService.login(live.username, 'local-password-123', 'new-device'), (error: any) => error.code === 'PHONE_OWNERSHIP_REQUIRED');
});
test('a heartbeat racing an inactive login cannot be overwritten without verification', async () => {
  const u = await session({ activeSessionLastSeenAt: new Date(Date.now() - SESSION_ACTIVITY_TTL_MS - 1000), telegramId: null });
  const original = authRepository.findByUsername;
  authRepository.findByUsername = async () => {
    await authRepository.touchSession(u._id.toString(), u.activeSessionId!, new Date());
    return u;
  };
  try { await assert.rejects(authService.login(u.username, 'local-password-123', 'new-device')); }
  finally { authRepository.findByUsername = original; }
  assert.equal((await UserModel.findById(u._id))!.activeSessionId, u.activeSessionId);
});
test('procurement and stale credentials cannot revive another device; heartbeat requires current auth', async () => {
  assert.equal((await request('/auth/session/heartbeat', {})).status, 401);
  const seen = new Date(Date.now() - SESSION_ACTIVITY_TTL_MS - 1000);
  const u = await session({ activeSessionLastSeenAt: seen });
  const scoped = await authService.loginAsProcurementAgent(u.username, 'local-password-123');
  assert.equal((await request('/auth/session/heartbeat', {}, scoped.token)).status, 403);
  assert.equal((await UserModel.findById(u._id))!.activeSessionLastSeenAt!.getTime(), seen.getTime());
});
test('platform administrators can attest their own Telegram contact while purchases stay tenant-only', async () => {
  const u = await session({ role: 'superAdmin', telegramId: null });
  const id = randomUUID();
  assert.equal((await paymentService.lookupUserByPhone(u.phone_number))!.userId, u._id.toString());
  await paymentService.linkTelegram(u._id.toString(), id, undefined, u.phone_number);
  await assert.rejects(paymentService.createManualPayment({ userId: u._id.toString(), telegramUserId: id, tier: 'bor', durationMonths: 1 }));
});
