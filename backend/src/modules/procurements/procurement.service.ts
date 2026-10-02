import { withOwnerTransaction, currentSession, currentRevision } from "../../lib/transaction";

import { env } from "../../config/env";
import { AppError } from "../../utils/app-error";
import { createLocalId } from "../../utils/ids";
import { getCurrentBusinessDate, getEffectiveHour } from "../../utils/business-day";
import { normalizeQuantity, normalizeUnit, roundQty, roundMoney } from "../../utils/quantity";
import type { AuthUser } from "../auth/auth.types";
import { auditService } from "../audit/audit.service";
import { inventoryRepository } from "../inventory/inventory.repository";
import { InventoryEntryModel } from "../inventory/inventory.model";
import { productRepository } from "../products/product.repository";
import { productService } from "../products/product.service";
import { snapshotService } from "../snapshots/snapshot.service";
import { ProcurementModel, type IProcurementItem } from "./procurement.model";
import { procurementRepository } from "./procurement.repository";

type ProcurementItemInput = {
  productId?: string;
  name: string;
  unit?: string;
  quantity: number;
  buyPrice: number;
  sellPrice?: number;
  deviceId?: string;
};

export class ProcurementService {
  async submitBatch(actor: AuthUser, items: ProcurementItemInput[]) {
    if (!items.length) {
      throw new AppError("At least one item is required", 422);
    }

    return withOwnerTransaction(actor.userId, () => this.submitBatchInTransaction(actor, items));
  }

  private async submitBatchInTransaction(actor: AuthUser, items: ProcurementItemInput[]) {
    const session = currentSession();
    const businessHour = getEffectiveHour(actor);
    const today = getCurrentBusinessDate(businessHour, env.TIMEZONE_OFFSET);
    const stockEpoch = currentRevision(actor.userId);

    const recordedItems: IProcurementItem[] = [];
    const touchedLocalIds: string[] = [];
    let totalCost = 0;

    for (const item of items) {
      if (item.productId) {
        const recorded = await this.restockExistingInTransaction(actor, item, today, stockEpoch);
        recordedItems.push(recorded);
        touchedLocalIds.push(recorded.productId);
      } else {
        const recorded = await this.createNewProductInTransaction(actor, item, today);
        recordedItems.push(recorded);
        touchedLocalIds.push(recorded.productId);
      }
      totalCost += recordedItems[recordedItems.length - 1].lineCost;
    }
    totalCost = roundMoney(totalCost);

    const procurement = await ProcurementModel.create(
      [
        {
          ownerAdminId: actor.userId,
          localId: createLocalId("prc", actor.userId),
          date: today,
          items: recordedItems,
          totalCost,
          createdByScope: actor.scope === "procurement" ? "procurement" : "full",
          createdByUserId: actor.userId,
        },
      ],
      { session }
    ).then((docs) => docs[0]);

    await auditService.log({
      ownerAdminId: actor.userId,
      action: "RESTOCK",
      entityType: "daily",
      entityId: procurement.localId,
      after: { totalCost, itemCount: recordedItems.length, createdByScope: procurement.createdByScope },
      source: "rest",
      createdBy: actor.userId,
    });

    await snapshotService.recompute(actor, today, "server", touchedLocalIds);

    return procurement;
  }

  private async restockExistingInTransaction(
    actor: AuthUser,
    item: ProcurementItemInput,
    today: string,
    stockEpoch: number | undefined,
  ): Promise<IProcurementItem> {
    const product = await productRepository.findByIdentifier(actor.userId, item.productId!);
    if (!product) {
      throw new AppError(`Product not found: ${item.productId}`, 404);
    }

    const unit = normalizeUnit((product as any).unit);
    if (unit === "dona" && !Number.isInteger(item.quantity)) throw new AppError("Dona miqdori butun son bo'lishi kerak", 422);
    const delta = normalizeQuantity(item.quantity, unit);
    if (delta <= 0) {
      throw new AppError(
        unit === "kg" ? "Qo'shiladigan miqdor 0 dan katta bo'lishi kerak" : "Qo'shiladigan miqdor kamida 1 dona bo'lishi kerak",
        422,
      );
    }
    const buyPrice = Number(item.buyPrice) || 0;

    const beforeEntry = await inventoryRepository.findByProductAndDate(actor.userId, (product as any).localId, today, currentSession());
    if (beforeEntry && roundQty(beforeEntry.currentQuantity) !== roundQty((product as any).quantity)) {
      throw new AppError("Stock projections disagree; reconcile before procurement", 409, undefined, "RECONCILIATION_REQUIRED");
    }

    // Freeze prior sales at their original cost before the new purchase cost
    // takes effect. Changing only Product.buyPrice leaves the cashier on the
    // old daily cost; changing only Inventory.buyPrice revalues past profit.
    if (beforeEntry) {
      const sold = roundQty(Math.max(beforeEntry.startQuantity - beforeEntry.currentQuantity, 0));
      await InventoryEntryModel.updateOne({ _id: beforeEntry._id, ownerAdminId: actor.userId }, { $set: {
        startQuantity: beforeEntry.currentQuantity,
        buyPrice,
        lockedSold: roundQty((beforeEntry.lockedSold ?? 0) + sold),
        lockedRevenue: roundMoney((beforeEntry.lockedRevenue ?? 0) + sold * (beforeEntry.sellPrice ?? 0)),
        lockedProfit: roundMoney((beforeEntry.lockedProfit ?? 0) + sold * ((beforeEntry.sellPrice ?? 0) - (beforeEntry.buyPrice ?? 0))),
      } }, { session: currentSession() });
    }

    const updated = await productRepository.incrementQuantityWithCost(
      actor.userId,
      (product as any)._id.toString(),
      delta,
      buyPrice,
      Number(stockEpoch ?? 0),
      currentSession(),
    );
    if (!updated) {
      throw new AppError(`Product not found: ${item.productId}`, 404);
    }

    const inventoryEntry = await inventoryRepository.incrementQuantitiesByProductAndDate(
      actor.userId,
      (product as any).localId,
      today,
      delta,
      currentSession(),
    );
    if (!inventoryEntry) {
      await inventoryRepository.upsertByProductAndDateWithSession(
        actor.userId,
        (product as any).localId,
        today,
        {
          localId: `${today}-${(product as any).localId}`,
          deviceId: (product as any).deviceId,
          productId: (product as any).localId,
          productName: (product as any).name,
          unit,
          date: today,
          startQuantity: roundQty((updated as any).quantity),
          currentQuantity: roundQty((updated as any).quantity),
          buyPrice,
          sellPrice: Number((updated as any).sellPrice || 0),
          note: "",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        currentSession(),
      );
    }

    await auditService.log({
      ownerAdminId: actor.userId,
      action: "RESTOCK",
      entityType: "product",
      entityId: (product as any).localId,
      before: { quantity: (product as any).quantity, buyPrice: (product as any).buyPrice, unit },
      after: { quantity: (updated as any).quantity, buyPrice, delta, unit },
      source: "rest",
      createdBy: actor.userId,
    });

    return {
      productId: (product as any).localId,
      name: (product as any).name,
      unit,
      quantity: delta,
      buyPrice,
      lineCost: roundMoney(delta * buyPrice),
      isNewProduct: false,
    };
  }

  private async createNewProductInTransaction(
    actor: AuthUser,
    item: ProcurementItemInput,
    today: string,
  ): Promise<IProcurementItem> {
    const unit = normalizeUnit(item.unit);
    if (unit === "dona" && !Number.isInteger(item.quantity)) throw new AppError("Dona miqdori butun son bo'lishi kerak", 422);
    const quantity = normalizeQuantity(item.quantity, unit);
    if (quantity <= 0) {
      throw new AppError(
        unit === "kg" ? "Miqdor 0 dan katta bo'lishi kerak" : "Miqdor kamida 1 dona bo'lishi kerak",
        422,
      );
    }
    const buyPrice = Number(item.buyPrice) || 0;
    // A Bozorchi only ever knows what they paid, not what it resells for —
    // default sellPrice to buyPrice (zero markup) so createProductSchema's
    // "sellPrice >= buyPrice" invariant holds; the admin sets a real sell
    // price later on the Products page.
    const sellPrice = item.sellPrice !== undefined ? Number(item.sellPrice) : buyPrice;

    const created = await productService.create(actor, {
      name: item.name,
      unit,
      quantity,
      buyPrice,
      sellPrice,
      deviceId: item.deviceId ?? "procurement",
    } as any);

    return {
      productId: (created as any).localId,
      name: (created as any).name,
      unit,
      quantity,
      buyPrice,
      lineCost: roundMoney(quantity * buyPrice),
      isNewProduct: true,
    };
  }

  async list(actor: AuthUser, from?: string, to?: string) {
    return procurementRepository.findRange(actor.userId, from, to);
  }
}

export const procurementService = new ProcurementService();
