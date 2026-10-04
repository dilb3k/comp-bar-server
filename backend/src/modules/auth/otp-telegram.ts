import { env } from "../../config/env";

export const OTP_DELIVERY_TIMEOUT_MS = 8_000;

// Sends the session-conflict OTP directly to the account owner's own linked
// Telegram id (see user.model.ts's telegramId, populated once they /start
// hisvex-bot and share their phone). OTP_TELEGRAM_BOT_TOKEN must identify that
// same interactive bot. BOT_TOKEN is only a compatibility fallback when the
// reporting bot and interactive bot are the same Telegram bot.
//
// Telegram is the available out-of-band channel. Missing linkage or delivery
// failure must fail closed; neither can waive an active-session challenge.
function rejectionReason(result: unknown, status: number): string {
  const error = result && typeof result === "object"
    ? result as { error_code?: unknown; description?: unknown }
    : undefined;
  const code = typeof error?.error_code === "number" ? error.error_code : status;
  const description = typeof error?.description === "string" ? error.description.toLowerCase() : "";
  if (code === 401) return "BOT_TOKEN_INVALID";
  if (description.includes("bot was blocked")) return "BOT_BLOCKED";
  if (description.includes("chat not found")) return "CHAT_NOT_FOUND";
  if (code === 403) return "TELEGRAM_FORBIDDEN";
  if (code === 429) return "TELEGRAM_RATE_LIMITED";
  return "TELEGRAM_REJECTED";
}

export async function sendOtpViaTelegram(telegramId: string, code: string): Promise<boolean> {
  const botToken = env.OTP_TELEGRAM_BOT_TOKEN?.trim() || env.BOT_TOKEN?.trim();
  if (!botToken) {
    console.error("[otp-telegram] BOT_TOKEN_MISSING: configure OTP_TELEGRAM_BOT_TOKEN for hisvex-bot");
    return false;
  }

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
    if (!delivered) {
      // Only fixed reason labels; never log Telegram's body, token, chat id or OTP.
      console.error(`[otp-telegram] ${rejectionReason(result, response.status)} (HTTP ${response.status})`);
    }
    return delivered;
  } catch {
    // Fetch errors may contain the bot token in the URL. Never log them raw.
    console.error("[otp-telegram] OTP delivery failed or timed out");
    return false;
  }
}
