import { assertBaseVersion } from "../../lib/versioning";
import { transactionScope, afterCommit, currentRevision, withReadSnapshot } from "../../lib/transaction";

import { env } from "../../config/env";
import { AppError } from "../../utils/app-error";
import { telegramReportService } from "../../services/telegram-report.service";
import { InventoryEntryModel } from "./inventory.model";
import {
  assertNotFutureDayKey,
  assertPaidRangeAllowed,
  compareDayKeys,
  getBusinessDateFromTimestamp,
  getCurrentBusinessDate,
  getEffectiveHour,
  isPastBusinessDate,
} from "../../utils/business-day";
import {
  formatQuantity,
  normalizeUnit,
  qtyGreaterThan,
  resolveLockedPrice,
  roundMoney,
  roundQty,
  type ProductUnit,
} from "../../utils/quantity";
import type { AuthUser } from "../auth/auth.types";
import { productRepository } from "../products/product.repository";
import { auditService } from "../audit/audit.service";
import { snapshotService } from "../snapshots/snapshot.service";
import { inventoryRepository } from "./inventory.repository";
import {
  calculateInventoryMetrics,
  deriveMissingInventoryEntry,
  aggregateInventory,
  aggregateInventoryForRange,
} from "./inventory.logic";

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * A "dona" product is countable, so half a piece is a client bug, not a valid
 * sale. Validation can't enforce this (it never sees the product, only the
 * payload), so the check lives here where the unit is known.
 */
function assertQuantityFitsUnit(quantity: number, unit: ProductUnit, productName?: string) {
  if (unit !== "kg" && !Number.isInteger(quantity)) {
    throw new AppError(
      `"${productName ?? "Mahsulot"}" dona bilan o'lchanadi — miqdor butun son bo'lishi kerak`,
      422,
    );
  }
}

// businessDayStartHour must be the *actor's* effective hour, not the global
// env default: every other business-date computation in this service uses
// getEffectiveHour(actor), so falling back to env here put a product's
// creation day on a different boundary than the day key it is compared
// against, wrongly hiding (or showing) products created near the boundary for
// any account whose hour differs from the server default.
function isProductVisibleOnDate(product: any, date: string, businessDayStartHour: number): boolean {
  if (!product) return false;
  const p = typeof product.toJSON === "function" ? product.toJSON() : product;
  if (p.createdAt) {
    const createdBusinessDate = getBusinessDateFromTimestamp(p.createdAt, businessDayStartHour, env.TIMEZONE_OFFSET);
    if (createdBusinessDate > date) return false;
  }
  return true;
}

type StartDayInput = {
  date?: string;
  deviceId: string;
  items: Array<{
    productId: string;
    baseVersion?: number;
    startQuantity: number;
    currentQuantity?: number;
    note?: string;
    localId?: string;
    updatedAt?: string;
    createdAt?: string;
  }>;
};

type BulkCurrentInput = {
  date?: string;
  deviceId: string;
  items: Array<{
    productId: string;
    baseVersion?: number;
    currentQuantity: number;
    lineRevenue?: number;
    note?: string;
  }>;
};

function buildInventoryResponse(product: any, inventory: any) {
  const productJson =
    typeof product?.toJSON === "function" ? product.toJSON() : product;
  const inventoryJson =
    typeof inventory?.toJSON === "function" ? inventory.toJSON() : inventory;

  const effectiveBuyPrice = resolveLockedPrice(inventoryJson?.buyPrice, toNumber(productJson?.buyPrice ?? 0));
  const effectiveSellPrice = resolveLockedPrice(inventoryJson?.sellPrice, toNumber(productJson?.sellPrice ?? 0));

  const metrics = calculateInventoryMetrics({
    startQuantity: toNumber(inventoryJson?.startQuantity ?? 0),
    currentQuantity: toNumber(inventoryJson?.currentQuantity ?? 0),
    buyPrice: effectiveBuyPrice,
    sellPrice: effectiveSellPrice,
    lockedRevenue: toNumber(inventoryJson?.lockedRevenue ?? 0),
    lockedProfit: toNumber(inventoryJson?.lockedProfit ?? 0),
    lockedSold: toNumber(inventoryJson?.lockedSold ?? 0),
  });

  // The live product is the authority on unit; the entry's denormalized copy
  // is the fallback that keeps history readable once a product is deleted.
  const unit = normalizeUnit(productJson?.unit ?? inventoryJson?.unit);

  return {
    ...inventoryJson,
    ...metrics,
    name: productJson?.name,
    quantity: productJson?.quantity,
    unit,
    buyPrice: effectiveBuyPrice,
    sellPrice: effectiveSellPrice,
    image: productJson?.image ?? "",
    product: productJson,
  };
}

export class InventoryService {
  private getAllowedDate(actor: AuthUser, date?: string, allowHistorical = false) {
    const businessHour = getEffectiveHour(actor);
    const currentBusinessDate = getCurrentBusinessDate(businessHour, env.TIMEZONE_OFFSET);
    const targetDate = date ?? currentBusinessDate;

    assertNotFutureDayKey(
      targetDate,
      currentBusinessDate,
      "Inventory cannot be created for a future date",
    );

    if (!allowHistorical && isPastBusinessDate(targetDate, currentBusinessDate)) {
      throw new AppError("Past business days cannot be edited", 409);
    }

    return { targetDate, currentBusinessDate };
  }

  async getByDate(actor: AuthUser, from?: string, to?: string) {
    return withReadSnapshot(()=>this.readByDate(actor,from,to));
  }

  private async readByDate(actor: AuthUser, from?: string, to?: string) {
    assertPaidRangeAllowed(actor, from, to);

    const entries = await inventoryRepository.findByDateRange(actor.userId,from,to);
    const products = await productRepository.findAllByOwner(actor.userId);

    const productMap = new Map(products.map((product) => [product.localId, product]));
    const productsWithInventory = new Set<string>();

    const items = entries.map((entry) => {
      productsWithInventory.add(entry.productId);
      const product = productMap.get(entry.productId) ?? null;

      if (!product) {
        const storedBuyPrice = toNumber(entry.buyPrice ?? 0);
        const storedSellPrice = toNumber(entry.sellPrice ?? 0);
        return {
          ...(typeof entry.toJSON === "function" ? entry.toJSON() : entry),
          ...calculateInventoryMetrics({
            startQuantity: toNumber(entry.startQuantity),
            currentQuantity: toNumber(entry.currentQuantity),
            buyPrice: storedBuyPrice,
            sellPrice: storedSellPrice,
            lockedRevenue: toNumber(entry.lockedRevenue ?? 0),
            lockedProfit: toNumber(entry.lockedProfit ?? 0),
            lockedSold: toNumber(entry.lockedSold ?? 0),
          }),
          name: entry.productName || "O'chirilgan mahsulot",
          buyPrice: storedBuyPrice,
          sellPrice: storedSellPrice,
          image: "",
          product: null,
        };
      }

      return buildInventoryResponse(product, entry);
    });

    const isSingleDate = from && to && from === to;
    if (isSingleDate) {
      const businessHour = getEffectiveHour(actor);
      for (const product of products) {
        if (!productsWithInventory.has(product.localId) && isProductVisibleOnDate(product, from, businessHour)) {
          const derived = deriveMissingInventoryEntry(product, from);
          items.push(buildInventoryResponse(product, derived));
        }
      }
    }

    const summary = aggregateInventoryForRange(items);

    return {
      items,
      summary,
    };
  }
  async getRange(actor:AuthUser,from:string,to:string) {
    if(compareDayKeys(from,to)>0) throw new AppError('from must be <= to',422);
    return this.getByDate(actor,from,to);
  }

  async startDay(actor: AuthUser, payload: StartDayInput) {
    const { targetDate } = this.getAllowedDate(actor, payload.date);
    const now = new Date();

    const transaction = await transactionScope(actor.userId);
    const { session } = transaction;
    try {
      const results = await transaction.run(async () => {
        const products = await productRepository.findByIdentifiers(
          actor.userId,
          payload.items.map((item) => item.productId),
          session,
        );
        const productMap = new Map<string, any>();

        for (const product of products) {
          productMap.set(product.localId, product);
          productMap.set(product._id.toString(), product);
        }

        const items: any[] = [];
        for (const item of payload.items) {
          const product = productMap.get(item.productId);

          if (!product) {
            throw new AppError(
              `Active product not found for productId=${item.productId}`,
              404,
            );
          }

          const unit = normalizeUnit((product as any).unit);
          const startQuantity = roundQty(item.startQuantity);
          const currentQuantity = roundQty(item.currentQuantity ?? item.startQuantity);

          assertQuantityFitsUnit(startQuantity, unit, (product as any).name);
          assertQuantityFitsUnit(currentQuantity, unit, (product as any).name);

          if (qtyGreaterThan(currentQuantity, startQuantity)) {
            throw new AppError(
              "currentQuantity cannot be greater than startQuantity",
              422,
            );
          }

          const existingEntry = await inventoryRepository.findByProductAndDate(
            actor.userId,
            (product as any).localId,
            targetDate,
            session,
          );

          assertBaseVersion(existingEntry as any, item.baseVersion);

          const entry = await inventoryRepository.upsertByProductAndDateWithSession(
            actor.userId,
            (product as any).localId,
            targetDate,
            {
              localId:
                item.localId ??
                `${targetDate}-${product.localId}`,
              deviceId: payload.deviceId,
              productId: (product as any).localId,
              productName: product.name ?? "",
              unit,
              date: targetDate,
              startQuantity,
              currentQuantity,
              buyPrice: toNumber(product.buyPrice || 0),
              sellPrice: toNumber(product.sellPrice || 0),
              lockedRevenue: toNumber((existingEntry as any)?.lockedRevenue ?? 0),
              lockedProfit: toNumber((existingEntry as any)?.lockedProfit ?? 0),
              lockedSold: toNumber((existingEntry as any)?.lockedSold ?? 0),
              note: item.note ?? "",
              createdAt: item.createdAt ? new Date(item.createdAt) : now,
              updatedAt: item.updatedAt ? new Date(item.updatedAt) : now,
            },
            session,
          );

          await productRepository.updateById(
            actor.userId,
            (product as any)._id.toString(),
            {
              quantity: currentQuantity,
              stockEpoch: currentRevision(actor.userId),
              updatedAt: now,
            },
            session,
          );

          await auditService.log({
            ownerAdminId: actor.userId,
            action: "START_DAY",
            entityType: "inventory",
            entityId: item.productId,
            after: { productId: item.productId, date: targetDate, startQuantity, currentQuantity },
            source: "rest",
            createdBy: actor.userId,
          });

          items.push(
            buildInventoryResponse(
              {
                ...product.toJSON(),
                quantity: currentQuantity,
                updatedAt: now.toISOString(),
              },
              entry,
            ),
          );
        }
        await snapshotService.recompute(actor, targetDate, payload.deviceId, items.map(item => item.productId));
        return items;
      });

      telegramReportService.reportInventoryStarted(actor, {
        date: targetDate,
        deviceId: payload.deviceId,
        items: results.map((entry) => ({
          productName: entry.product?.name,
          unit: entry.unit,
          startQuantity: toNumber(entry.startQuantity),
          currentQuantity: toNumber(entry.currentQuantity),
          sold: toNumber(entry.sold),
        })),
      });

      return results;
    } finally {
      await transaction.close();
    }
  }

  async bulkUpdateCurrent(actor: AuthUser, payload: BulkCurrentInput) {
    const { targetDate } = this.getAllowedDate(actor, payload.date);
    const now = new Date();

    const transaction = await transactionScope(actor.userId);
    const { session } = transaction;
    try {
      const results = await transaction.run(async () => {
        const products = await productRepository.findByIdentifiers(
          actor.userId,
          payload.items.map((item) => item.productId),
          session,
        );
        const productMap = new Map<string, any>();

        for (const product of products) {
          productMap.set(product.localId, product);
          productMap.set(product._id.toString(), product);
        }

        // Sequential (not Promise.all) — every op below shares the same
        // ClientSession, and the MongoDB driver does not support concurrent
        // operations on one session (undefined behaviour if parallelized).
        const items: any[] = [];
        for (const item of payload.items) {
          const product = productMap.get(item.productId);

          if (!product) {
            throw new AppError(
              `Active product not found for productId=${item.productId}`,
              404,
            );
          }

          const existing = await inventoryRepository.findByProductAndDate(
            actor.userId,
            (product as any).localId,
            targetDate,
            session,
          );

          assertBaseVersion(existing as any, item.baseVersion);

          const unit = normalizeUnit((product as any).unit);
          const currentQuantity = roundQty(item.currentQuantity);
          assertQuantityFitsUnit(currentQuantity, unit, (product as any).name);

          const productQuantity = toNumber((product as any).quantity ?? 0);

          if (existing && qtyGreaterThan(currentQuantity, toNumber((existing as any).startQuantity))) {
            throw new AppError(
              "currentQuantity cannot be greater than startQuantity",
              422,
            );
          }

          if (!existing && qtyGreaterThan(currentQuantity, productQuantity)) {
            throw new AppError(
              "currentQuantity cannot be greater than product quantity",
              422,
            );
          }

          const startQuantity = existing
            ? toNumber((existing as any).startQuantity)
            : productQuantity;

          const buyPrice = toNumber((existing as any)?.buyPrice ?? product.buyPrice ?? 0);
          const sellPrice = toNumber((existing as any)?.sellPrice ?? product.sellPrice ?? 0);

          let lockedRevenue = toNumber((existing as any)?.lockedRevenue ?? 0);
          let lockedProfit = toNumber((existing as any)?.lockedProfit ?? 0);
          let lockedSold = toNumber((existing as any)?.lockedSold ?? 0);
          let nextStartQuantity = startQuantity;

          // `lineRevenue` restates the money taken for everything this entry
          // counts as sold — the "Kutilgan tushum" field on the inventory
          // screen. The whole derived span therefore moves into the locked
          // accumulators at that amount and collapses (start meets current),
          // so nothing is left to be re-valued at the list price. Profit
          // follows on its own: the cost of those units has not changed, so
          // every so'm taken off the revenue comes straight off the profit.
          const derivedSold = roundQty(Math.max(startQuantity - currentQuantity, 0));
          if (item.lineRevenue !== undefined && derivedSold > 0) {
            const stated = roundMoney(item.lineRevenue);
            lockedSold = roundQty(lockedSold + derivedSold);
            lockedRevenue = roundMoney(lockedRevenue + stated);
            lockedProfit = roundMoney(lockedProfit + stated - derivedSold * buyPrice);
            nextStartQuantity = currentQuantity;
          }

          const updated = await inventoryRepository.upsertByProductAndDateWithSession(
            actor.userId,
            (product as any).localId,
            targetDate,
            {
              localId:
                (existing as any)?.localId ??
                `${targetDate}-${(product as any).localId}`,
              deviceId: payload.deviceId,
              productId: (product as any).localId,
              productName: product.name ?? "",
              unit,
              date: targetDate,
              startQuantity: nextStartQuantity,
              currentQuantity,
              buyPrice,
              sellPrice,
              lockedRevenue,
              lockedProfit,
              lockedSold,
              note: item.note ?? (existing as any)?.note ?? "",
              createdAt: (existing as any)?.createdAt ?? now,
              updatedAt: now,
            },
            session,
          );

          await productRepository.updateById(
            actor.userId,
            (product as any)._id.toString(),
            {
              quantity: currentQuantity,
              stockEpoch: currentRevision(actor.userId),
              updatedAt: now,
            },
            session,
          );

          const action = existing ? "UPDATE" : "START_DAY";
          await auditService.log({
            ownerAdminId: actor.userId,
            action,
            entityType: "inventory",
            entityId: item.productId,
            before: existing
              ? { currentQuantity: (existing as any).currentQuantity }
              : undefined,
            after: {
              productId: item.productId,
              date: targetDate,
              startQuantity: nextStartQuantity,
              currentQuantity,
              unit,
              ...(item.lineRevenue !== undefined ? { revenue: roundMoney(item.lineRevenue) } : {}),
            },
            source: "rest",
            createdBy: actor.userId,
          });

          items.push(
            buildInventoryResponse(
              {
                ...product.toJSON(),
                quantity: currentQuantity,
                updatedAt: now.toISOString(),
              },
              updated,
            ),
          );
        }
        await snapshotService.recompute(actor, targetDate, payload.deviceId, items.map(item => item.productId));
        return items;
      });

      telegramReportService.reportInventoryUpdated(actor, {
        date: targetDate,
        deviceId: payload.deviceId,
        items: results.map((entry) => ({
          productName: entry.product?.name,
          unit: entry.unit,
          startQuantity: toNumber(entry.startQuantity),
          currentQuantity: toNumber(entry.currentQuantity),
          sold: toNumber(entry.sold),
        })),
      });

      return results;
    } finally {
      await transaction.close();
    }
  }

  /**
   * Record a sale.
   *
   * A line may state what it actually brought in, either as `lineRevenue`
   * (money for the whole line — exact, and what a hand-typed total uses) or
   * as `unitPrice` (a haggled per-unit price). Those units cannot be valued
   * by the usual derivation (`(startQuantity - currentQuantity) * sellPrice`),
   * so they move into the entry's `locked*` accumulators at the money actually
   * taken, the same mechanism a mid-day price correction already uses:
   *
   *   lockedSold    += qty
   *   lockedRevenue += chargedRevenue
   *   lockedProfit  += chargedRevenue - qty * buyPrice
   *   startQuantity -= qty   (in lockstep, so the derived portion is untouched)
   *   currentQuantity -= qty
   *
   * The day's opening stock stays recoverable as `startQuantity + lockedSold`
   * (what aggregateInventoryForRange and the statistics screens already do),
   * and revenue is exact to the so'm regardless of how many different prices
   * one product sold at during the day. Because the accumulator holds an
   * amount rather than a price, a figure the user typed is stored exactly —
   * 25 000 over 3 units stays 25 000, which no per-unit price can express.
   *
   * A line at the list price skips all of that and just decrements
   * currentQuantity, keeping the common case byte-identical to before.
   */
  async sales(actor: AuthUser, payload: {
    date?: string;
    deviceId: string;
    lines: Array<{ productId: string; quantity: number; unitPrice?: number; lineRevenue?: number; expectedBuyPrice?: number; expectedUnit?: ProductUnit; expectedStockEpoch?: number }>;
  }, options: { allowHistorical?: boolean } = {}) {
    const { targetDate, currentBusinessDate } = this.getAllowedDate(actor, payload.date, options.allowHistorical);
    const historical = targetDate < currentBusinessDate;
    const now = new Date();

    const transaction = await transactionScope(actor.userId);
    const { session } = transaction;
    try {
      let snapshot: any;
      const items = await transaction.run(async () => {
        const productIds = payload.lines.map((l) => l.productId);
        const products = await productRepository.findByIdentifiers(
          actor.userId,
          productIds,
          session,
        );
        const productMap = new Map<string, any>();
        for (const p of products) {
          productMap.set(p.localId, p);
          productMap.set(p._id.toString(), p);
        }

        // Sequential (not Promise.all) — every op below shares the same
        // ClientSession, and the MongoDB driver does not support concurrent
        // operations on one session (undefined behaviour if parallelized). This
        // also ensures multiple lines for the same product in one sale are
        // applied cumulatively instead of racing on the same read.
        const results: any[] = [];
        for (const line of payload.lines) {
          const product = productMap.get(line.productId);
          if (!product) {
            throw new AppError(`Product not found: ${line.productId}`, 404);
          }

          const existing = await inventoryRepository.findByProductAndDate(
            actor.userId,
            (product as any).localId,
            targetDate,
            session,
          );

          // No blanket refusal when a historical day never got its own entry
          // (e.g. the whole day had zero activity until this one queued,
          // offline sale finally arrived) — the fallback below (startQty/
          // currentQty = live productQty) and the later-entries adjustment
          // further down already make this safe: a late sale is applied by
          // shifting every later day's start/current back by the same
          // amount, and that block's own existence check (`invalid`, below)
          // still refuses outright if any later day can't absorb the shift
          // without going negative — which is the only way this could
          // actually conflict with something.
          const unit = normalizeUnit((product as any).unit);
          const quantity = roundQty(line.quantity);
          assertQuantityFitsUnit(quantity, unit, (product as any).name);

          const productQty = toNumber((product as any).quantity ?? 0);
          const startQty = existing
            ? toNumber((existing as any).startQuantity)
            : productQty;
          const currentQty = existing
            ? toNumber((existing as any).currentQuantity)
            : productQty;

          if (!historical && existing && Math.abs(productQty - currentQty) > 0.0005) {
            throw new AppError("Stock projections disagree; reconciliation required", 409, undefined, "RECONCILIATION_REQUIRED");
          }
          if (qtyGreaterThan(quantity, currentQty) || qtyGreaterThan(quantity, productQty)) {
            throw new AppError(
              `Sotilgan miqdor (${formatQuantity(quantity, unit)}) qoldiqdan (${formatQuantity(currentQty, unit)}) ko'p bo'lishi mumkin emas`,
              422,
            );
          }

          const buyPrice = toNumber((existing as any)?.buyPrice ?? product.buyPrice ?? 0);
          const listSellPrice = toNumber((existing as any)?.sellPrice ?? product.sellPrice ?? 0);
          // Delta sales may commute with other sales/restocks, but never cross
          // an absolute stock count or silently inherit a different unit/cost.
          if ((line.expectedBuyPrice !== undefined && roundMoney(line.expectedBuyPrice) !== roundMoney(buyPrice)) ||
              (line.expectedUnit !== undefined && line.expectedUnit !== unit) ||
              (line.expectedStockEpoch !== undefined && line.expectedStockEpoch !== Number(product.stockEpoch ?? 0))) {
            throw new AppError("Stock count, cost or unit changed; reconcile the saved operation", 409, undefined, "RECONCILIATION_REQUIRED");
          }

          // Money for this line. `lineRevenue` wins over `unitPrice` — it is
          // an exact amount, so a hand-typed cart total survives intact where
          // a per-unit price would round (see the validation schema).
          const listRevenue = roundMoney(quantity * listSellPrice);
          const chargedRevenue =
            line.lineRevenue !== undefined
              ? roundMoney(line.lineRevenue)
              : line.unitPrice !== undefined
                ? roundMoney(quantity * line.unitPrice)
                : listRevenue;

          let lockedRevenue = toNumber((existing as any)?.lockedRevenue ?? 0);
          let lockedProfit = toNumber((existing as any)?.lockedProfit ?? 0);
          let lockedSold = toNumber((existing as any)?.lockedSold ?? 0);

          const newCurrent = roundQty(currentQty - quantity);
          // Off-list units can't be valued by the start-minus-current
          // derivation, so they move into the locked accumulators at the money
          // actually taken and drop out of the derived span entirely (both
          // quantities fall together). See this method's doc comment.
          const isOffList = Math.abs(chargedRevenue - listRevenue) > 0.005;
          const newStart = isOffList ? roundQty(startQty - quantity) : startQty;

          if (isOffList) {
            lockedSold = roundQty(lockedSold + quantity);
            lockedRevenue = roundMoney(lockedRevenue + chargedRevenue);
            lockedProfit = roundMoney(lockedProfit + chargedRevenue - quantity * buyPrice);
          }

          const updated = await inventoryRepository.upsertByProductAndDateWithSession(
            actor.userId,
            (product as any).localId,
            targetDate,
            {
              localId:
                (existing as any)?.localId ??
                `${targetDate}-${(product as any).localId}`,
              deviceId: payload.deviceId,
              productId: (product as any).localId,
              productName: product.name ?? "",
              unit,
              date: targetDate,
              startQuantity: newStart,
              currentQuantity: newCurrent,
              buyPrice,
              sellPrice: listSellPrice,
              lockedRevenue,
              lockedProfit,
              lockedSold,
              note: (existing as any)?.note ?? "",
              createdAt: (existing as any)?.createdAt ?? now,
              updatedAt: now,
            },
            session,
          );

          let liveQuantity = newCurrent;
          if (historical) {
            const laterFilter = { ownerAdminId: actor.userId, productId: product.localId, date: { $gt: targetDate } };
            const invalid = await InventoryEntryModel.exists({ ...laterFilter, $or: [
              { currentQuantity: { $lt: quantity } }, { startQuantity: { $lt: quantity } },
            ] }).session(session);
            if (invalid) throw new AppError("Late sale conflicts with later stock; operation retained for review", 409, undefined, "RECONCILIATION_REQUIRED");
            const laterEntries = await InventoryEntryModel.find(laterFilter).select("date").session(session).lean();
            await InventoryEntryModel.updateMany(laterFilter, { $inc: { currentQuantity: -quantity, startQuantity: -quantity } }, { session });
            for (const entry of laterEntries) await snapshotService.recompute(actor, entry.date, payload.deviceId, [product.localId]);
            liveQuantity = roundQty(productQty - quantity);
          }
          await productRepository.updateById(actor.userId, product._id.toString(), { quantity: liveQuantity, updatedAt: now }, session);
          product.quantity = liveQuantity;

          await auditService.log({
            ownerAdminId: actor.userId,
            action: "UPDATE",
            entityType: "inventory",
            entityId: line.productId,
            before: existing
              ? { currentQuantity: (existing as any).currentQuantity }
              : undefined,
            after: {
              productId: line.productId,
              date: targetDate,
              currentQuantity: newCurrent,
              sold: quantity,
              unit,
              // Recorded on every sale, not just discounted ones: the trail
              // has to answer "what was this actually sold for" without
              // needing the product's price history to reconstruct it.
              revenue: chargedRevenue,
              buyPrice,
              listRevenue,
              discount: roundMoney(listRevenue - chargedRevenue),
            },
            source: "rest",
            createdBy: actor.userId,
          });

          results.push(
            buildInventoryResponse(
              {
                ...product.toJSON(),
                quantity: newCurrent,
                updatedAt: now.toISOString(),
              },
              updated,
            ),
          );
        }

        snapshot = await snapshotService.recompute(actor, targetDate, payload.deviceId, results.map(item => item.productId));
        return results;
      });

      telegramReportService.reportInventoryUpdated(actor, {
        date: targetDate,
        deviceId: payload.deviceId,
        items: items.map((entry) => ({
          productName: entry.product?.name,
          unit: entry.unit,
          startQuantity: toNumber(entry.startQuantity),
          currentQuantity: toNumber(entry.currentQuantity),
          sold: toNumber(entry.sold),
        })),
      });

      return { items, snapshot };
    } finally {
      await transaction.close();
    }
  }

  async getDashboard(actor: AuthUser) {
    return withReadSnapshot(()=>this.readDashboard(actor));
  }

  private async readDashboard(actor:AuthUser) {
    const businessHour = getEffectiveHour(actor);
    const today = getCurrentBusinessDate(businessHour, env.TIMEZONE_OFFSET);

    const products=await productRepository.findAllByOwner(actor.userId);
    const inventoryResult=await this.getByDate(actor,today,today);
    const snapshot=await snapshotService.getDaily(actor,today);

    return {
      products,
      inventory: inventoryResult.items,
      inventorySummary: inventoryResult.summary,
      snapshot,
    };
  }

  /**
   * Read-only, minimal-field product/stock snapshot for the
   * allowStale-authenticated preview route: a device whose session was
   * replaced elsewhere (see auth.middleware's SESSION_REPLACED) can still
   * hit this with its old token to glance at stock while stuck on the
   * phone-verification screen. Deliberately excludes buy price / profit —
   * nothing a normal cashier view wouldn't already show.
   */
  async getPreview(actor: AuthUser) {
    const businessHour = getEffectiveHour(actor);
    const today = getCurrentBusinessDate(businessHour, env.TIMEZONE_OFFSET);
    const { items } = await this.getByDate(actor, today, today);

    return items.map((item: any) => ({
      productId: item.productId,
      name: item.name,
      unit: item.unit,
      sellPrice: toNumber(item.sellPrice),
      currentQuantity: toNumber(item.currentQuantity),
    }));
  }
}

export const inventoryService = new InventoryService();
