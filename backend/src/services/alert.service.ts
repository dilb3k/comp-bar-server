import { env } from "../config/env";

// Ops/infrastructure alerts (failover, DB connectivity, 5xx crashes) — kept
// separate from telegram-report.service.ts's business-event reports (new
// product, sale, sync) so an incident storm never buries, or gets buried by,
// normal traffic in the same chat.
export type AlertType = "failover" | "failover_recovered" | "db_error" | "critical_error";

// "Har 2-3 daqiqada ko'pi bilan 1 marta": a flapping DB connection or a
// crash-looping route would otherwise fire one Telegram message per failed
// request/reconnect attempt. Throttled per alert TYPE (not globally) so a
// failover alert is never held back by an unrelated DB-error alert's cooldown.
const THROTTLE_MS = 2 * 60 * 1000;
const lastSentAt = new Map<AlertType, number>();

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

class AlertService {
  private readonly botToken = env.BOT_TOKEN?.trim();
  private readonly chatId = (env.ALERT_TELEGRAM_CHAT_ID ?? env.TELEGRAM_CHAT_ID)?.trim();

  isEnabled(): boolean {
    return Boolean(this.botToken && this.chatId);
  }

  private shouldThrottle(type: AlertType): boolean {
    const now = Date.now();
    const last = lastSentAt.get(type);
    if (last !== undefined && now - last < THROTTLE_MS) {
      return true;
    }
    lastSentAt.set(type, now);
    return false;
  }

  private async send(text: string): Promise<void> {
    const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: this.chatId,
        text,
        parse_mode: "HTML",
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram API ${response.status}: ${body}`);
    }
  }

  // Never throws and never awaited by callers — an alert failing to send
  // must not affect the request/error path that triggered it. Silently
  // drops the alert (logged, not thrown) when a type is being throttled.
  private dispatch(type: AlertType, title: string, lines: Array<string | undefined>): void {
    if (!this.isEnabled()) return;
    if (this.shouldThrottle(type)) {
      console.warn(`[alertService] throttled (${type}): ${title}`);
      return;
    }

    const text = [
      `⚠️ <b>${escapeHtml(title)}</b>`,
      ...lines.filter((line): line is string => Boolean(line)).map((line) => escapeHtml(line)),
      `Vaqt: ${escapeHtml(new Date().toISOString())}`,
    ].join("\n");

    void this.send(text).catch((error) => {
      console.error(`[alertService] failed to send (${type})`, error);
    });
  }

  // Reported by a client (web/desktop) right after it fails over from
  // Railway to Render — see the new POST /api/ops/failover route. The
  // backend itself can't reliably alert on its own outage (there's no
  // running process to send from while Railway is down), so this is a
  // client-observed event relayed through whichever backend is currently
  // reachable.
  reportFailover(input: { from: string; to: string; reason?: string; reportedBy?: string }): void {
    this.dispatch("failover", "🔴 Failover: server almashtirildi", [
      `${escapeHtml(input.from)} → ${escapeHtml(input.to)}`,
      input.reason ? `Sabab: ${input.reason}` : undefined,
      input.reportedBy ? `Xabar bergan: ${input.reportedBy}` : undefined,
    ]);
  }

  reportFailoverRecovered(input: { server: string; reportedBy?: string }): void {
    this.dispatch("failover_recovered", "🟢 Asosiy server tiklandi", [
      `${escapeHtml(input.server)} qayta faol, trafik unga qaytdi`,
      input.reportedBy ? `Xabar bergan: ${input.reportedBy}` : undefined,
    ]);
  }

  reportDbError(message: string): void {
    this.dispatch("db_error", "🛑 MongoDB bilan aloqa xatosi", [message]);
  }

  reportCriticalError(input: { statusCode: number; method: string; path: string; message: string }): void {
    this.dispatch("critical_error", `🛑 Kritik server xatosi (HTTP ${input.statusCode})`, [
      `${escapeHtml(input.method)} ${escapeHtml(input.path)}`,
      `Xabar: ${input.message}`,
    ]);
  }
}

export const alertService = new AlertService();
