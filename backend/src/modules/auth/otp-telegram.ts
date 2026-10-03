import { env } from "../../config/env";

export const OTP_DELIVERY_TIMEOUT_MS = 8_000;

// Sends the session-conflict OTP directly to the account owner's own linked
// Telegram id (see user.model.ts's telegramId, populated once they /start
// hisvex-bot and share their phone). Uses the same BOT_TOKEN already
// configured for ops alerts/business-event reports — a bot can only DM a
// user who has started a conversation with it, so this only ever reaches
// someone who has actually gone through that linking flow, never a cold id.
//
// Telegram is the available out-of-band channel. Missing linkage or delivery
// failure must fail closed; neither can waive an active-session challenge.
export async function sendOtpViaTelegram(telegramId: string, code: string): Promise<boolean> {
  const botToken = env.BOT_TOKEN?.trim();
  if (!botToken) return false;

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      signal: AbortSignal.timeout(OTP_DELIVERY_TIMEOUT_MS),
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
    // Telegram's JSON result is authoritative, including on an HTTP 200.
    const result: unknown = await response.json();
    const delivered = response.ok && !!result && typeof result === "object" && "ok" in result && result.ok === true;
    if (!delivered) console.error(`[otp-telegram] Telegram rejected OTP delivery (HTTP ${response.status})`);
    return delivered;
  } catch {
    // Fetch errors may contain the bot token in the URL. Never log them raw.
    console.error("[otp-telegram] OTP delivery failed or timed out");
    return false;
  }
}
