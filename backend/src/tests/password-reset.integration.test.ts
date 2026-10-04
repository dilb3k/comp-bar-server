import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { createApp } from "../app";
import { env } from "../config/env";
import { currentSession, OwnerWriteVersion } from "../lib/transaction";
import { UserModel } from "../modules/auth/user.model";
import { authRepository } from "../modules/auth/auth.repository";
import { authService } from "../modules/auth/auth.service";
import { hashOtp, phoneVerificationRequired, signAccessToken, signRefreshToken } from "../modules/auth/auth.utils";
import { PasswordResetModel, ensurePasswordResetStorage } from "../modules/auth/password-reset.model";
import { passwordResetService as reset } from "../modules/auth/password-reset.service";
import { SessionChallengeModel } from "../modules/auth/session-challenge.model";

let server: ReturnType<ReturnType<typeof createApp>["listen"]>, base: string;
let serial = 71000000;
const secret = "local-password-reset-test-only";
const oldPassword = "old-local-password-123";
const newPassword = "new-local-password-456";
before(async () => {
  assert.match(process.env.MONGODB_URL ?? "", /^mongodb:\/\/127\.0\.0\.1:\d+\/hisvex_integration\?/);
  env.BOT_INTERNAL_SECRET = secret;
  await mongoose.connect(process.env.MONGODB_URL!);
  await Promise.all([UserModel, PasswordResetModel, SessionChallengeModel, OwnerWriteVersion].map(model => model.init()));
  server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await mongoose.disconnect();
});
const user = (extra: Record<string, unknown> = {}) => UserModel.create({ username: `reset-${randomUUID()}`, password: oldPassword, phone_number: `99890${++serial}`, telegramId: String(serial), role: "admin", isActive: true, activeSessionId: randomUUID(), activeSessionLastSeenAt: new Date(), verifiedDeviceIds: ["old-device"], ...extra });
const token = (url: string) => new URLSearchParams(new URL(url).hash.slice(1)).get("token")!;
async function request(path: string, body?: unknown, botSecret?: string, accessToken?: string) {
  const response = await fetch(base + path, { method: body === undefined ? "GET" : "POST", headers: {
    "Content-Type": "application/json", ...(botSecret ? { "X-Bot-Secret": botSecret } : {}), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, cache: response.headers.get("cache-control"), body: await response.json() as any };
}
test("explicit reset storage setup is idempotent and includes token uniqueness and automatic expiry", async () => {
  await PasswordResetModel.collection.dropIndexes();
  await ensurePasswordResetStorage();
  await ensurePasswordResetStorage();
  const indexes = await PasswordResetModel.collection.indexes();
  assert.ok(indexes.some(index => index.key.tokenHash === 1 && index.unique));
  assert.ok(indexes.some(index => index.key.expiresAt === 1 && index.expireAfterSeconds === 0));
  assert.ok(indexes.some(index => index.key.userId === 1));
});
test("only the trusted bot can create a reset link for its linked Telegram sender", async () => {
  const u = await user();
  assert.equal((await request("/bot/password-reset", { telegramId: u.telegramId })).status, 401);
  assert.equal((await request("/bot/password-reset", { telegramId: u.telegramId }, "wrong-local-secret")).status, 401);
  const reply = await request("/bot/password-reset", { telegramId: u.telegramId, userId: "forged", resetUrl: "https://attacker.test" }, secret);
  assert.equal(reply.status, 200); assert.equal(reply.cache, "no-store");
  const proof = reply.body.data;
  const url = new URL(proof.resetUrl);
  assert.equal(url.origin, "https://hisvex-web.vercel.app"); assert.equal(url.pathname, "/reset-password"); assert.equal(url.search, "");
  assert.match(token(proof.resetUrl), /^[A-Za-z0-9_-]{43}$/);
  const stored = await PasswordResetModel.findOne({ userId: u._id.toString() });
  assert.equal(stored!.tokenHash, hashOtp(token(proof.resetUrl)));
  assert.ok(stored!.expiresAt.getTime() > Date.now() + 590000);
  assert.ok(stored!.expiresAt.getTime() <= Date.now() + 600000);
  assert.equal(JSON.stringify(stored).includes(token(proof.resetUrl)), false);
  assert.equal(await u.comparePassword(oldPassword), true);
  assert.equal((await request("/bot/password-reset", { telegramId: u.telegramId }, secret)).status, 429);
});
test("chat reset requires bot authentication and cannot be confirmed publicly or by another Telegram sender", async () => {
  const u = await user(), other = await user();
  const path = "/bot/password-reset/chat";
  assert.equal((await request(path, { telegramId: u.telegramId })).status, 401);
  assert.equal((await request(path, { telegramId: u.telegramId }, "wrong-secret")).status, 401);
  const begin = await request(path, { telegramId: u.telegramId, userId: other._id.toString(), purpose: "web" }, secret);
  assert.equal(begin.status, 200); assert.equal(begin.cache, "no-store");
  assert.deepEqual(Object.keys(begin.body.data).sort(), ["expiresAt", "token"]);
  const proof = begin.body.data.token;
  assert.match(proof, /^[A-Za-z0-9_-]{43}$/);
  const stored = await PasswordResetModel.findOne({ tokenHash: hashOtp(proof) });
  assert.equal(stored!.purpose, "telegram"); assert.equal(stored!.userId, u._id.toString());
  assert.equal(JSON.stringify(stored).includes(proof), false);
  const body = { telegramId: u.telegramId, token: proof, password: newPassword };
  assert.equal((await request(path + "/confirm", body)).status, 401);
  assert.equal((await request(path + "/confirm", body, "wrong-secret")).status, 401);
  assert.equal((await request("/auth/password/reset", body)).body.error.code, "PASSWORD_RESET_INVALID");
  assert.equal((await request(path + "/confirm", { ...body, telegramId: other.telegramId }, secret)).body.error.code, "PASSWORD_RESET_INVALID");
  assert.equal((await PasswordResetModel.findById(stored!._id))!.consumed, false);
  assert.equal(await (await UserModel.findById(u._id))!.comparePassword(oldPassword), true);

  const id = u._id.toString();
  const claims = { userId: id, username: u.username, role: "admin" as const, isPayed: false, tier: "tekin" as const, sessionId: u.activeSessionId!, securityVersion: 0 };
  const access = signAccessToken(claims), scoped = signAccessToken({ ...claims, scope: "procurement" });
  const refresh = signRefreshToken({ userId: id, sessionId: u.activeSessionId! });
  const reply = await request(path + "/confirm", { ...body, role: "superAdmin" }, secret);
  assert.equal(reply.status, 200); assert.equal(reply.cache, "no-store"); assert.equal(reply.body.data.reset, true);
  const saved = await UserModel.findById(id);
  assert.equal(saved!.role, "admin"); assert.equal(saved!.securityVersion, 1);
  assert.equal(await saved!.comparePassword(newPassword), true); assert.notEqual(saved!.password, newPassword);
  assert.equal((await request("/auth/me", undefined, undefined, access)).status, 401);
  assert.equal((await request("/auth/me", undefined, undefined, scoped)).status, 401);
  await assert.rejects(authService.refresh(refresh));
  assert.equal((await request(path + "/confirm", body, secret)).body.error.code, "PASSWORD_RESET_INVALID");
  assert.equal(await (await UserModel.findById(other._id))!.comparePassword(oldPassword), true);
});
test("chat confirmation cannot consume a web proof, including links issued before purpose was stored", async () => {
  const u = await user(), proof = await reset.request(u.telegramId!);
  const raw = token(proof.resetUrl);
  await assert.rejects(reset.confirm(raw, newPassword, u.telegramId!), (e: any) => e.code === "PASSWORD_RESET_INVALID");
  await PasswordResetModel.collection.updateOne({ tokenHash: hashOtp(raw) }, { $unset: { purpose: "" } });
  await assert.rejects(reset.confirm(raw, newPassword, u.telegramId!), (e: any) => e.code === "PASSWORD_RESET_INVALID");
  assert.equal((await reset.confirm(raw, newPassword)).reset, true);
});
test("expired, rebound and credential-invalidated chat proofs cannot change a password", async () => {
  for (const kind of ["expired", "rebound", "credentials", "inactive"]) {
    const u = await user(), proof = await reset.requestInChat(u.telegramId!);
    if (kind === "expired") await PasswordResetModel.updateOne({ tokenHash: hashOtp(proof.token) }, { $set: { expiresAt: new Date(0) } });
    if (kind === "rebound") await UserModel.updateOne({ _id: u._id }, { $set: { telegramId: String(++serial) } });
    if (kind === "credentials") await UserModel.updateOne({ _id: u._id }, { $inc: { securityVersion: 1 } });
    if (kind === "inactive") await UserModel.updateOne({ _id: u._id }, { $set: { isActive: false } });
    await assert.rejects(reset.confirm(proof.token, newPassword, u.telegramId!), (e: any) => e.code === "PASSWORD_RESET_INVALID");
    assert.equal(await (await UserModel.findById(u._id))!.comparePassword(oldPassword), true);
  }
});
test("simultaneous chat confirmations change the password only once", async () => {
  const u = await user(), proof = await reset.requestInChat(u.telegramId!);
  const body = { telegramId: u.telegramId, token: proof.token, password: newPassword };
  const replies = await Promise.all(Array.from({ length: 4 }, () => request("/bot/password-reset/chat/confirm", body, secret)));
  assert.equal(replies.filter(reply => reply.status === 200).length, 1);
  assert.equal(replies.filter(reply => reply.status === 400 && reply.body.error.code === "PASSWORD_RESET_INVALID").length, 3);
  assert.equal((await UserModel.findById(u._id))!.securityVersion, 1);
});
test("invalid chat passwords and identities are rejected without consuming the proof", async () => {
  const u = await user(), proof = await reset.requestInChat(u.telegramId!);
  for (const password of ["short", "a".repeat(73), "😀".repeat(19)]) {
    assert.equal((await request("/bot/password-reset/chat/confirm", { telegramId: u.telegramId, token: proof.token, password }, secret)).status, 422);
  }
  assert.equal((await request("/bot/password-reset/chat/confirm", { telegramId: "invalid", token: proof.token, password: newPassword }, secret)).status, 422);
  assert.equal((await PasswordResetModel.findOne({ tokenHash: hashOtp(proof.token) }))!.consumed, false);
});
test("unlinked, deactivated and ambiguous Telegram identities cannot choose an account", async () => {
  await assert.rejects(reset.request("999999999999"), (e: any) => e.statusCode === 404);
  const inactive = await user({ isActive: false });
  await assert.rejects(reset.request(inactive.telegramId!), (e: any) => e.statusCode === 404);
  const first = await user();
  await assert.rejects(user({ telegramId: first.telegramId }), (e: any) => e.code === 11000);
  // Simulate a legacy ambiguous lookup without dropping the live schema's
  // uniqueness index shared by the other integration-test processes.
  const original = UserModel.find;
  UserModel.find = (() => ({ limit: async () => [first, first] })) as any;
  try { await assert.rejects(reset.request(first.telegramId!), (e: any) => e.statusCode === 404); }
  finally { UserModel.find = original; }
  assert.equal(await PasswordResetModel.countDocuments({ telegramId: first.telegramId }), 0);
});
test("password reset hashes the password, revokes all session scopes and OTPs, and never grants a role", async () => {
  const u = await user();
  const id = u._id.toString();
  const claims = { userId: id, username: u.username, role: "admin" as const, isPayed: false, tier: "tekin" as const, sessionId: u.activeSessionId!, securityVersion: 0 };
  const access = signAccessToken(claims), scoped = signAccessToken({ ...claims, scope: "procurement" });
  const refresh = signRefreshToken({ userId: id, sessionId: u.activeSessionId! });
  const otp = await SessionChallengeModel.create({ userId: id, securityVersion: 0, otpHash: hashOtp("123456"), expiresAt: new Date(Date.now() + 600000) });
  const proof = await reset.request(u.telegramId!);
  const reply = await request("/auth/password/reset", { token: token(proof.resetUrl), password: newPassword, role: "superAdmin" });
  assert.equal(reply.status, 200); assert.equal(reply.cache, "no-store");
  assert.deepEqual(reply.body.data, { reset: true, userId: id, username: u.username });
  const saved = await UserModel.findById(id);
  assert.equal(saved!.role, "admin"); assert.equal(saved!.securityVersion, 1);
  assert.notEqual(saved!.password, newPassword); assert.equal(await saved!.comparePassword(newPassword), true);
  assert.deepEqual(saved!.verifiedDeviceIds, []); assert.equal(phoneVerificationRequired(saved!), false);
  assert.equal((await SessionChallengeModel.findById(otp._id))!.consumed, true);
  assert.equal((await request("/auth/me", undefined, undefined, access)).status, 401);
  assert.equal((await request("/auth/me", undefined, undefined, scoped)).status, 401);
  await assert.rejects(authService.refresh(refresh));
  await assert.rejects(authService.login(u.username, oldPassword));
  assert.ok("token" in await authService.login(u.username, newPassword));
  await assert.rejects(reset.confirm(token(proof.resetUrl), "replay-password"), (e: any) => e.code === "PASSWORD_RESET_INVALID");
});
test("expired, forged, wrong-purpose and rebound Telegram proofs fail closed", async () => {
  await assert.rejects(reset.confirm("A".repeat(43), newPassword));
  const expired = await user(); const proof = await reset.request(expired.telegramId!);
  await PasswordResetModel.updateOne({ tokenHash: hashOtp(token(proof.resetUrl)) }, { $set: { expiresAt: new Date(Date.now() - 1) } });
  await assert.rejects(reset.confirm(token(proof.resetUrl), newPassword));
  const relinked = await user(); const bound = await reset.request(relinked.telegramId!);
  await UserModel.updateOne({ _id: relinked._id }, { $set: { telegramId: "888888888888" } });
  await assert.rejects(reset.confirm(token(bound.resetUrl), newPassword));
  assert.equal(await (await UserModel.findById(relinked._id))!.comparePassword(oldPassword), true);
});
test("admin password/security changes invalidate a previously issued reset", async () => {
  const u = await user(); const proof = await reset.request(u.telegramId!);
  await authRepository.updateAdmin(u._id.toString(), { password: "administrator-password" });
  await assert.rejects(reset.confirm(token(proof.resetUrl), newPassword));
  assert.equal(await (await UserModel.findById(u._id))!.comparePassword("administrator-password"), true);
});
test("parallel confirms apply only one password and a newer request invalidates the older link", async () => {
  const u = await user(); const first = await reset.request(u.telegramId!);
  await PasswordResetModel.updateMany({ userId: u._id.toString() }, { $set: { createdAt: new Date(Date.now() - 61000) } });
  const second = await reset.request(u.telegramId!);
  await assert.rejects(reset.confirm(token(first.resetUrl), newPassword));
  const outcomes = await Promise.allSettled([reset.confirm(token(second.resetUrl), "parallel-password-a"), reset.confirm(token(second.resetUrl), "parallel-password-b")]);
  assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
  assert.equal((await UserModel.findById(u._id))!.securityVersion, 1);
});
test("simultaneous bot taps create just one reset link and share the cooldown across API replicas", async () => {
  const u = await user();
  const outcomes = await Promise.allSettled(Array.from({ length: 6 }, () => reset.request(u.telegramId!)));
  assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1);
  for (const outcome of outcomes) if (outcome.status === "rejected") assert.equal(outcome.reason.code, "PASSWORD_RESET_RATE_LIMITED");
  assert.equal(await PasswordResetModel.countDocuments({ userId: u._id.toString(), consumed: false }), 1);
});
test("failed password save rolls back proof consumption and credential changes", async () => {
  const u = await user(); const proof = await reset.request(u.telegramId!);
  const original = UserModel.prototype.save;
  UserModel.prototype.save = async function () {
    assert.ok(currentSession()); throw Error("injected password save failure");
  };
  try { await assert.rejects(reset.confirm(token(proof.resetUrl), newPassword), /injected/); }
  finally { UserModel.prototype.save = original; }
  assert.equal((await PasswordResetModel.findOne({ tokenHash: hashOtp(token(proof.resetUrl)) }))!.consumed, false);
  assert.equal(await (await UserModel.findById(u._id))!.comparePassword(oldPassword), true);
  assert.equal((await reset.confirm(token(proof.resetUrl), newPassword)).reset, true);
});
test("password reset rejects invalid credentials without consuming a valid proof", async () => {
  const u = await user(); const proof = await reset.request(u.telegramId!);
  for (const password of ["short", "🔐".repeat(19)]) assert.equal((await request("/auth/password/reset", { token: token(proof.resetUrl), password })).status, 422);
  assert.equal((await PasswordResetModel.findOne({ tokenHash: hashOtp(token(proof.resetUrl)) }))!.consumed, false);
});
