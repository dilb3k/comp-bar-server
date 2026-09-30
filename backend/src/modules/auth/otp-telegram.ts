import { env } from "../../config/env";

// Sends the session-conflict OTP directly to the account owner's own linked
// Telegram id (see user.model.ts's telegramId, populated once they /start
// hisvex-bot and share their phone). Uses the same BOT_TOKEN already
// configured for ops alerts/business-event reports — a bot can only DM a
// user who has started a conversation with it, so this only ever reaches
// someone who has actually gone through that linking flow, never a cold id.
//
// No SMS gateway exists anywhere in this codebase (comp-bar-server has never
// integrated Eskiz.uz/Twilio/any SMS provider) — Telegram is the only
// out-of-band channel actually available. A user with no telegramId linked
// falls back to the older, weaker "re-type your phone number" verification
// (see phoneVerificationRequired's caller in auth.service.ts) rather than
// being locked out entirely.
export async function sendOtpViaTelegram(telegramId: string, code: string): Promise<boolean> {
  const botToken = env.BOT_TOKEN?.trim();
  if (!botToken) return false;

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: telegramId,
        text:
          `🔐 <b>Kirish tasdiqlash kodi</b>\n\n` +
          `Kodingiz: <code>${code}</code>\n\n` +
          `Bu kod 3 daqiqa amal qiladi. Agar bu kirish urinishi sizga tegishli bo'lmasa, bu xabarni e'tiborsiz qoldiring va parolingizni almashtiring.`,
        parse_mode: "HTML",
      }),
    });
    return response.ok;
  } catch (error) {
    console.error("[otp-telegram] failed to send OTP DM", error);
    return false;
  }
}
