import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { createApp } from "../app";
import { env } from "../config/env";
import { registrationPhoneService as phones } from "../modules/auth/registration-phone.service";
import { RegistrationPhoneModel } from "../modules/auth/registration-phone.model";
import { UserModel } from "../modules/auth/user.model";
import { SubscriptionModel } from "../modules/subscriptions/subscription.model";
import { OwnerWriteVersion } from "../lib/transaction";
import { authService } from "../modules/auth/auth.service";
import { hashOtp } from "../modules/auth/auth.utils";

let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
let base: string;
let sequence = 7100000;
const identity = () => ({ telegramId: String(++sequence), phone: `99890${sequence}` });
const startToken = (url: string) => new URL(url).searchParams.get("start")!.slice(4);
before(async () => {
  assert.match(process.env.MONGODB_URL ?? "", /^mongodb:\/\/127\.0\.0\.1:\d+\/hisvex_integration\?/);
  await mongoose.connect(process.env.MONGODB_URL!);
  await Promise.all([RegistrationPhoneModel, UserModel, SubscriptionModel, OwnerWriteVersion].map(model => model.init()));
  env.ALLOW_PUBLIC_REGISTER = true;
  env.BOT_INTERNAL_SECRET = "local-registration-test";
  server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await mongoose.disconnect();
});
async function request(path: string, body: unknown, botSecret?: string) {
  const response = await fetch(base + path, { method: "POST", headers: {
    "Content-Type": "application/json", ...(botSecret ? { "X-Bot-Secret": botSecret } : {}),
  }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() as any, cache: response.headers.get("cache-control") };
}
async function verified() {
  const who = identity();
  const challenge = await phones.begin();
  await phones.start(startToken(challenge.botUrl), who.telegramId);
  await phones.confirm(who.telegramId, who.telegramId, who.phone);
  return { ...who, ...challenge };
}
test("form → bot Start → own contact → form → signup links Telegram before the first login", async () => {
  const who = identity();
  const begin = await request("/auth/register/phone", {});
  assert.equal(begin.status, 200);
  assert.equal(begin.cache, "no-store");
  const challenge = begin.body.data;
  assert.notEqual(challenge.token, startToken(challenge.botUrl));
  assert.ok(new URL(challenge.botUrl).searchParams.get("start")!.length <= 64);
  const pending = await request("/auth/register/phone/status", { token: challenge.token });
  assert.deepEqual(pending.body.data, { verified: false, phone: null });
  for (let n = 0; n < 12; n++) assert.equal((await request("/auth/register/phone/status", { token: challenge.token })).status, 200);
  const bind = { startToken: startToken(challenge.botUrl), telegramId: who.telegramId };
  assert.equal((await request("/bot/registration/start", bind)).status, 401);
  assert.equal((await request("/bot/registration/start", bind, "local-registration-test")).status, 200);
  const contact = { telegramId: who.telegramId, contactUserId: who.telegramId, phone: who.phone, telegramUsername: "phone-test" };
  assert.equal((await request("/bot/registration/confirm", { ...contact, contactUserId: "999" }, "local-registration-test")).status, 403);
  assert.equal((await request("/bot/registration/confirm", contact, "local-registration-test")).body.data.verified, true);
  assert.equal((await request("/auth/register/phone/status", { token: challenge.token })).body.data.phone, who.phone);
  const signup = await request("/auth/register", {
    username: `verified-${randomUUID()}`, password: "local-password-123", phone_number: who.phone,
    phoneVerificationToken: challenge.token, telegramId: "forged", role: "superAdmin",
  });
  assert.equal(signup.status, 200);
  assert.equal(signup.body.data.user.telegramId, who.telegramId);
  assert.equal(signup.body.data.user.role, "admin");
  assert.equal((await request("/auth/register/phone/status", { token: challenge.token })).status, 410);
});
test("unverified, forged, wrong-phone and expired proofs cannot create an account", async () => {
  const input = { username: `denied-${randomUUID()}`, password: "local-password-123", phone_number: identity().phone };
  await assert.rejects(authService.register(input), (err: any) => err.code === "PHONE_OWNERSHIP_REQUIRED");
  const pending = await phones.begin();
  await assert.rejects(authService.register({ ...input, phoneVerificationToken: pending.token }));
  const proof = await verified();
  await assert.rejects(authService.register({ ...input, phoneVerificationToken: proof.token }));
  await assert.rejects(phones.consume(startToken(proof.botUrl), proof.phone));
  await RegistrationPhoneModel.updateOne({ tokenHash: hashOtp(proof.token) }, { $set: { expiresAt: new Date(Date.now() - 1) } });
  await assert.rejects(phones.status(proof.token), (err: any) => err.statusCode === 410);
  await assert.rejects(phones.consume(proof.token, proof.phone));
  assert.equal(await UserModel.countDocuments({ username: input.username }), 0);
});
test("Start binding survives process-local state loss and cannot switch Telegram owners", async () => {
  const who = identity();
  const challenge = await phones.begin();
  await phones.start(startToken(challenge.botUrl), who.telegramId);
  await assert.rejects(phones.start(startToken(challenge.botUrl), "999"));
  assert.equal((await phones.confirm(who.telegramId, who.telegramId, who.phone)).verified, true);
  assert.equal((await phones.start(startToken(challenge.botUrl), who.telegramId)).verified, true);
  assert.equal((await phones.status(challenge.token)).phone, who.phone);
  await assert.rejects(phones.confirm(who.telegramId, who.telegramId, identity().phone));
});
test("one proof can be consumed once even with simultaneous requests", async () => {
  const proof = await verified();
  const attempts = await Promise.allSettled([phones.consume(proof.token, proof.phone), phones.consume(proof.token, proof.phone)]);
  assert.equal(attempts.filter(value => value.status === "fulfilled").length, 1);
});
test("concurrent signups with different verified phones cannot attach one Telegram to two accounts", async () => {
  const first = await verified();
  const second = { ...await phones.begin(), phone: identity().phone, telegramId: first.telegramId };
  await phones.start(startToken(second.botUrl), second.telegramId);
  await phones.confirm(second.telegramId, second.telegramId, second.phone);
  const input = (proof: typeof first | typeof second) => ({ username: `parallel-${randomUUID()}`, password: "local-password-123", phone_number: proof.phone, phoneVerificationToken: proof.token });
  const outcomes = await Promise.allSettled([authService.register(input(first)), authService.register(input(second))]);
  assert.equal(outcomes.filter(value => value.status === "fulfilled").length, 1);
  assert.equal(await UserModel.countDocuments({ telegramId: first.telegramId }), 1);
});
