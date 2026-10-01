import { z } from "zod";
import { createHash } from "node:crypto";
import { AppError } from "../../utils/app-error";
import { assertBaseVersion } from "../../lib/versioning";
import { withIdempotency } from "../idempotency/idempotency.service";
import type { AuthUser } from "../auth/auth.types";
import { productRepository } from "../products/product.repository";
import { productService } from "../products/product.service";
import { createProductSchema, updateProductSchema } from "../products/product.validation";
import { applyInventoryOperation } from "../inventory/operation.service";
import { syncPayloadSchema } from "./sync.validation";
import { pullChanges } from "./sync.pull";

type SyncInput = z.infer<typeof syncPayloadSchema>;
export class SyncService {
  async sync(actor: AuthUser, payload: SyncInput) {
    const rejected: Array<{ entity: string; localId: string; reason: string; message?: string }> = [];
    const acknowledged: Array<{ entity: string; localId: string; updatedAt?: string }> = [];
    const accepted = { products: 0, inventory: 0, snapshots: 0, operations: 0 };
    // Each queued operation commits independently; a conflict never discards
    // the rest of a batch. Retrying a partially delivered response is safe.
    for (const item of payload.products ?? []) {
      try {
        const key = item.operationId ?? `sync-product:${createHash("sha256").update(`${item.localId}:${item.updatedAt}`).digest("hex")}`;
        await withIdempotency(actor.userId, key, async () => {
          const existing: any = await productRepository.findByIdentifier(actor.userId, item.localId);
          const { createdAt: _created, updatedAt: _updated, ...fields } = item;
          if (existing) {
            assertBaseVersion(existing, item.baseVersion);
            await productService.update(actor, item.localId, updateProductSchema.parse(fields));
          } else {
            if ((item.baseVersion ?? 0) !== 0) throw new AppError("Product no longer exists", 409, undefined, "ENTITY_DELETED");
            if(payload.protocolVersion!==2 || !item.operationId || item.baseVersion===undefined) throw new AppError("Legacy product creation requires reviewed migration; original client queue must be retained",409,undefined,"LEGACY_RECONCILIATION_REQUIRED");
            await productService.create(actor, createProductSchema.parse(fields) as any);
          }
          return { status: 200, data: { localId: item.localId } };
        }, { operation: "sync.product.v2", payload: item });
        accepted.products++;
        acknowledged.push({ entity: "product", localId: item.localId, updatedAt: item.updatedAt });
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        rejected.push({ entity: "product", localId: item.localId, reason: error.code ?? `HTTP_${error.statusCode}`, message: error.message });
      }
    }
    for (const deletion of payload.deletions ?? []) {
      try {
        await withIdempotency(actor.userId,deletion.operationId,async()=>{
          const existing:any=await productRepository.findByIdentifier(actor.userId,deletion.localId);
          if(!existing) throw new AppError("Product no longer exists",409,undefined,"ENTITY_DELETED");
          assertBaseVersion(existing,deletion.baseVersion);
          await productService.remove(actor,deletion.localId);
          return {status:200,data:{localId:deletion.localId}};
        },{operation:"sync.deleteProduct.v2",payload:deletion});
        acknowledged.push({entity:"deletion",localId:deletion.localId});
      } catch(error) {
        if(!(error instanceof AppError)) throw error;
        rejected.push({entity:"deletion",localId:deletion.localId,reason:error.code??`HTTP_${error.statusCode}`,message:error.message});
      }
    }
    for (const operation of payload.operations ?? []) {
      try {
        await applyInventoryOperation(actor, operation);
        accepted.operations++;
        acknowledged.push({ entity: "operation", localId: operation.id });
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        rejected.push({ entity: "operation", localId: operation.id, reason: error.code ?? `HTTP_${error.statusCode}`, message: error.message });
      }
    }
    // Absolute offline stock and client-computed reports cannot be merged
    // safely. Clients retain these legacy records for explicit reconciliation.
    for (const [entity, items] of [["inventory", payload.inventory], ["snapshot", payload.daily ?? payload.snapshots]] as const) {
      for (const item of items ?? []) rejected.push({ entity, localId: item.localId, reason: "LEGACY_RECONCILIATION_REQUIRED" });
    }
    const serverTime = new Date().toISOString();
    const pulled = await pullChanges(actor, payload);
    return { accepted, acknowledged, rejected, ...pulled, serverTime,
      upgradeRequired: payload.protocolVersion !== 2,
    };
  }
}
export const syncService = new SyncService();
