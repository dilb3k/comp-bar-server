import { randomBytes, randomUUID } from "node:crypto";
import { env } from "../../config/env";
import { currentSession, withOwnerTransaction } from "../../lib/transaction";
import { AppError } from "../../utils/app-error";
import { hashOtp } from "./auth.utils";
import { UserModel } from "./user.model";
import { SessionChallengeModel } from "./session-challenge.model";
import { PasswordResetModel } from "./password-reset.model";

const invalid = () => new AppError("Havola ishlatilgan yoki muddati tugagan. Telegram botidan yangi havola oling.", 400, undefined, "PASSWORD_RESET_INVALID");
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

function resetPage() {
  // CLIENT_URL can be '*' or an origin list for CORS. Fall back to the
  // canonical web app; never generate a link to an insecure/credential URL.
  try {
    const url = new URL(env.CLIENT_URL);
    if (url.protocol === "https:" && !url.username && !url.password) return new URL("/reset-password", url.origin);
  } catch {}
  return new URL("https://hisvex-web.vercel.app/reset-password");
}

export const passwordResetService = {
  // Called only by botAuth routes. Account ownership comes from the sender's
  // durable Telegram link, never a client-provided user ID or typed phone.
  async request(telegramId: string) {
    if (!/^\d{1,20}$/.test(telegramId)) throw new AppError("Telegram hisobi noto‘g‘ri.", 422);
    const users = await UserModel.find({ telegramId, isActive: true }).limit(2);
    if (users.length !== 1) throw new AppError("Hisobingizni avval /start orqali ulang. Bir nechta hisob bog‘langan bo‘lsa, yordamga murojaat qiling.", 404, undefined, "PASSWORD_RESET_ACCOUNT_UNAVAILABLE");
    const owner = users[0]._id.toString();
    return withOwnerTransaction(owner, async () => {
      const user = await UserModel.findOne({ _id: owner, telegramId, isActive: true }).session(currentSession() ?? null);
      if (!user) throw invalid();
      const recent = await PasswordResetModel.exists({ userId: owner, createdAt: { $gt: new Date(Date.now() - 60000) } }).session(currentSession() ?? null);
      if (recent) throw new AppError("Yangi havola olish uchun 1 daqiqa kutib, qayta bosing.", 429, undefined, "PASSWORD_RESET_RATE_LIMITED");
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      await PasswordResetModel.updateMany({ userId: owner, consumed: false }, { $set: { consumed: true } }, { session: currentSession() });
      await PasswordResetModel.create([{ userId: owner, telegramId, securityVersion: Number(user.securityVersion ?? 0), tokenHash: hashOtp(token), expiresAt }], { session: currentSession() });
      const url = resetPage();
      // A fragment does not travel in HTTP request logs or Referer headers.
      url.hash = `token=${token}`;
      return { resetUrl: url.toString(), expiresAt: expiresAt.toISOString() };
    });
  },
  async confirm(token: string, password: string) {
    if (!tokenPattern.test(token)) throw invalid();
    if (typeof password !== "string" || password.length < 6 || Buffer.byteLength(password, "utf8") > 72) {
      throw new AppError("Parol kamida 6 belgi va ko‘pi bilan 72 bayt bo‘lsin.", 422);
    }
    const tokenHash = hashOtp(token);
    const found = await PasswordResetModel.findOne({ tokenHash, consumed: false, expiresAt: { $gt: new Date() } });
    if (!found) throw invalid();
    return withOwnerTransaction(found.userId, async () => {
      const proof = await PasswordResetModel.findOneAndUpdate({ _id: found._id, tokenHash, consumed: false, expiresAt: { $gt: new Date() } },
        { $set: { consumed: true } }, { new: true, session: currentSession() });
      if (!proof) throw invalid();
      const user = await UserModel.findOne({ _id: proof.userId, telegramId: proof.telegramId, isActive: true }).session(currentSession() ?? null);
      if (!user || Number(user.securityVersion ?? 0) !== proof.securityVersion) throw invalid();
      user.password = password; // The model's save hook hashes it with bcrypt.
      user.securityVersion = Number(user.securityVersion ?? 0) + 1;
      user.activeSessionId = randomUUID();
      user.activeSessionLastSeenAt = null;
      user.activeSessionExpiresAt = new Date(0);
      user.verifiedDeviceIds = [];
      await user.save({ session: currentSession() });
      await SessionChallengeModel.updateMany({ userId: proof.userId, consumed: false }, { $set: { consumed: true } }, { session: currentSession() });
      await PasswordResetModel.updateMany({ userId: proof.userId, consumed: false }, { $set: { consumed: true } }, { session: currentSession() });
      return { reset: true, userId: user._id.toString(), username: user.username };
    });
  },
};
