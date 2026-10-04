import { randomBytes } from "node:crypto";
import { env } from "../../config/env";
import { currentSession } from "../../lib/transaction";
import { AppError } from "../../utils/app-error";
import { hashOtp, normalizePhone } from "./auth.utils";
import { RegistrationPhoneModel } from "./registration-phone.model";

const unavailable = () => new AppError("Tasdiqlash muddati tugadi. Formadan botni qayta oching.", 410);
const active = () => ({ consumed: false, expiresAt: { $gt: new Date() } });
const proofRequired = () => new AppError("Telefon tasdiqlanmadi yoki muddati tugadi. Botni qayta oching.", 403, undefined, "PHONE_OWNERSHIP_REQUIRED");

export const registrationPhoneService = {
  async begin() {
    if (!env.ALLOW_PUBLIC_REGISTER) throw new AppError("Ro‘yxatdan o‘tish yopiq.", 403, undefined, "PUBLIC_REGISTRATION_DISABLED");
    if (!env.BOT_INTERNAL_SECRET) throw new AppError("Telegram bot vaqtincha mavjud emas.", 503);
    // The bot receives only the start token. Only this form can read or consume
    // the proof, using a separate random token that never appears in a URL.
    const token = randomBytes(32).toString("base64url");
    const startToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await RegistrationPhoneModel.create({ tokenHash: hashOtp(token), startHash: hashOtp(startToken), expiresAt });
    return { token, botUrl: `https://t.me/hisvex_bot?start=reg_${startToken}`, expiresAt: expiresAt.toISOString() };
  },
  async status(token: string) {
    const proof = await RegistrationPhoneModel.findOne({ tokenHash: hashOtp(token), ...active() });
    if (!proof) throw unavailable();
    return { verified: !!proof.phone, phone: proof.phone ?? null };
  },
  async start(startToken: string, telegramId: string) {
    const proof = await RegistrationPhoneModel.findOneAndUpdate({
      startHash: hashOtp(startToken), ...active(), $or: [{ telegramId: null }, { telegramId }],
    }, { $set: { telegramId } }, { new: true });
    if (!proof) throw unavailable();
    return { verified: !!proof.phone };
  },
  async confirm(telegramId: string, contactUserId: string, phoneNumber: string, telegramUsername?: string) {
    if (telegramId !== contactUserId) throw new AppError("O‘zingizning kontaktingizni yuboring.", 403);
    const phone = normalizePhone(phoneNumber);
    if (phone.length < 7 || phone.length > 15) throw new AppError("Telefon raqami noto‘g‘ri.", 422);
    // The durable binding survives bot restarts between Start and contact.
    const proof = await RegistrationPhoneModel.findOne({ telegramId, ...active() }).sort({ createdAt: -1, _id: -1 });
    if (!proof) return { verified: false };
    if (proof.phone && proof.phone !== phone) throw new AppError("Bu tasdiqlash boshqa raqamga tegishli.", 409);
    const updated = await RegistrationPhoneModel.findOneAndUpdate({
      _id: proof._id, telegramId, ...active(), $or: [{ phone: null }, { phone }],
    }, { $set: { phone, telegramUsername: telegramUsername ?? null } }, { new: true });
    if (!updated) throw unavailable();
    return { verified: true };
  },
  async consume(token: string | undefined, phone: string) {
    if (!token) throw new AppError("Telefonni Telegram bot orqali tasdiqlang.", 403, undefined, "PHONE_OWNERSHIP_REQUIRED");
    const proof = await RegistrationPhoneModel.findOneAndUpdate({
      tokenHash: hashOtp(token), phone, telegramId: { $ne: null }, ...active(),
    }, { $set: { consumed: true } }, { new: true, session: currentSession() });
    if (!proof) throw proofRequired();
    return { telegramId: proof.telegramId as string, telegramUsername: proof.telegramUsername as string | null };
  },
  async verifiedOwner(token: string | undefined, phone: string) {
    if (!token) throw proofRequired();
    const proof = await RegistrationPhoneModel.findOne({
      tokenHash: hashOtp(token), phone, telegramId: { $ne: null }, ...active(),
    });
    if (!proof) throw proofRequired();
    return proof.telegramId as string;
  },
};
