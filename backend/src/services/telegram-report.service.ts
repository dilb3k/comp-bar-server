import { env } from "../config/env";

type TelegramReportPayload = {
  title: string;
  actor?: {
    userId?: string;
    username?: string;
    role?: string;
  } | null;
  lines?: Array<string | number | null | undefined | false>;
};

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }

  return String(value);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

class TelegramReportService {
  private readonly botToken = env.BOT_TOKEN?.trim();
  private readonly chatId = env.TELEGRAM_CHAT_ID?.trim();

  isEnabled() {
    return Boolean(this.botToken && this.chatId);
  }

  dispatch(payload: TelegramReportPayload) {
    if (!this.isEnabled()) {
      return;
    }

    void this.send(payload).catch((error) => {
      console.error("Telegram report failed", error);
    });
  }

  private buildMessage(payload: TelegramReportPayload) {
    const lines = [
      `<b>${escapeHtml(payload.title)}</b>`,
      payload.actor?.username ? `Admin: ${escapeHtml(payload.actor.username)}` : undefined,
      payload.actor?.role ? `Role: ${escapeHtml(payload.actor.role)}` : undefined,
      payload.actor?.userId ? `Admin ID: <code>${escapeHtml(payload.actor.userId)}</code>` : undefined,
      ...(
        payload.lines?.filter(Boolean).map((line) => escapeHtml(String(line))) ?? []
      ),
      `Vaqt: ${escapeHtml(new Date().toISOString())}`
    ];

    return lines.filter(Boolean).join("\n");
  }

  private async send(payload: TelegramReportPayload) {
    const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: this.chatId,
        text: this.buildMessage(payload),
        parse_mode: "HTML"
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Telegram API ${response.status}: ${text}`);
    }
  }

  reportProductCreated(
    actor: TelegramReportPayload["actor"],
    product: {
      localId?: string;
      name?: string;
      quantity?: number;
      buyPrice?: number;
      sellPrice?: number;
      deviceId?: string;
    }
  ) {
    this.dispatch({
      title: "Yangi mahsulot saqlandi",
      actor,
      lines: [
        `Mahsulot: ${formatValue(product.name)}`,
        `Local ID: ${formatValue(product.localId)}`,
        `Qoldiq: ${formatValue(product.quantity)}`,
        `Olish narxi: ${formatValue(product.buyPrice)}`,
        `Sotish narxi: ${formatValue(product.sellPrice)}`,
        `Device ID: ${formatValue(product.deviceId)}`
      ]
    });
  }

  reportProductUpdated(
    actor: TelegramReportPayload["actor"],
    product: {
      localId?: string;
      name?: string;
      quantity?: number;
      buyPrice?: number;
      sellPrice?: number;
      deviceId?: string;
    }
  ) {
    this.dispatch({
      title: "Mahsulot yangilandi",
      actor,
      lines: [
        `Mahsulot: ${formatValue(product.name)}`,
        `Local ID: ${formatValue(product.localId)}`,
        `Yangi qoldiq: ${formatValue(product.quantity)}`,
        `Olish narxi: ${formatValue(product.buyPrice)}`,
        `Sotish narxi: ${formatValue(product.sellPrice)}`,
        `Device ID: ${formatValue(product.deviceId)}`
      ]
    });
  }

  reportProductDeleted(
    actor: TelegramReportPayload["actor"],
    product: {
      localId?: string;
      name?: string;
    }
  ) {
    this.dispatch({
      title: "Mahsulot o'chirildi",
      actor,
      lines: [
        `Mahsulot: ${formatValue(product.name)}`,
        `Local ID: ${formatValue(product.localId)}`
      ]
    });
  }

  reportInventoryStarted(
    actor: TelegramReportPayload["actor"],
    payload: {
      date: string;
      deviceId: string;
      items: Array<{
        productName?: string;
        startQuantity: number;
        currentQuantity: number;
        sold: number;
      }>;
    }
  ) {
    this.dispatch({
      title: "Kun boshlandi: inventar saqlandi",
      actor,
      lines: [
        `Sana: ${formatValue(payload.date)}`,
        `Device ID: ${formatValue(payload.deviceId)}`,
        `Pozitsiyalar soni: ${payload.items.length}`,
        ...payload.items.map(
          (item) =>
            `${formatValue(item.productName)} | start=${formatValue(item.startQuantity)} | current=${formatValue(item.currentQuantity)} | sold=${formatValue(item.sold)}`
        )
      ]
    });
  }

  reportInventoryUpdated(
    actor: TelegramReportPayload["actor"],
    payload: {
      date: string;
      deviceId: string;
      items: Array<{
        productName?: string;
        startQuantity: number;
        currentQuantity: number;
        sold: number;
      }>;
    }
  ) {
    this.dispatch({
      title: "Inventar yangilandi",
      actor,
      lines: [
        `Sana: ${formatValue(payload.date)}`,
        `Device ID: ${formatValue(payload.deviceId)}`,
        `Pozitsiyalar soni: ${payload.items.length}`,
        ...payload.items.map(
          (item) =>
            `${formatValue(item.productName)} | start=${formatValue(item.startQuantity)} | current=${formatValue(item.currentQuantity)} | sold=${formatValue(item.sold)}`
        )
      ]
    });
  }

  reportSnapshotSaved(
    actor: TelegramReportPayload["actor"],
    snapshot: {
      date: string;
      totalRevenue: number;
      totalProfit: number;
      totalSoldItems: number;
      itemCount: number;
      deviceId?: string;
    }
  ) {
    this.dispatch({
      title: "Kunlik hisobot saqlandi",
      actor,
      lines: [
        `Sana: ${formatValue(snapshot.date)}`,
        `Jami tushum: ${formatValue(snapshot.totalRevenue)}`,
        `Jami foyda: ${formatValue(snapshot.totalProfit)}`,
        `Sotilgan soni: ${formatValue(snapshot.totalSoldItems)}`,
        `Itemlar soni: ${formatValue(snapshot.itemCount)}`,
        `Device ID: ${formatValue(snapshot.deviceId)}`
      ]
    });
  }

  reportAdminCreated(
    actor: TelegramReportPayload["actor"],
    admin: {
      username?: string;
      role?: string;
      createdBy?: string | null;
    }
  ) {
    this.dispatch({
      title: "Yangi admin yaratildi",
      actor,
      lines: [
        `Username: ${formatValue(admin.username)}`,
        `Role: ${formatValue(admin.role)}`,
        `Created by: ${formatValue(admin.createdBy)}`
      ]
    });
  }

  reportSync(
    actor: TelegramReportPayload["actor"],
    summary: {
      products: number;
      inventory: number;
      snapshots: number;
      lastSyncAt?: string;
    }
  ) {
    this.dispatch({
      title: "Sync orqali ma'lumot saqlandi",
      actor,
      lines: [
        `Products: ${summary.products}`,
        `Inventory: ${summary.inventory}`,
        `Snapshots: ${summary.snapshots}`,
        summary.lastSyncAt ? `Last sync: ${summary.lastSyncAt}` : undefined
      ]
    });
  }
}

export const telegramReportService = new TelegramReportService();
