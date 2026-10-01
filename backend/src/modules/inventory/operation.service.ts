import { z } from "zod";
import { currentRevision } from "../../lib/transaction";
import type { AuthUser } from "../auth/auth.types";
import { withIdempotency } from "../idempotency/idempotency.service";
import { productService } from "../products/product.service";
import { inventoryService } from "./inventory.service";
import { inventoryOperationSchema } from "./inventory.validation";
export type InventoryOperation = z.infer<typeof inventoryOperationSchema>;
export async function applyInventoryOperation(actor: AuthUser, input: z.input<typeof inventoryOperationSchema>) {
  const operation = inventoryOperationSchema.parse(input);
  return withIdempotency(actor.userId, operation.id, async () => {
    if (operation.kind === "sale") await inventoryService.sales(actor, operation, { allowHistorical: true });
    else if (operation.kind === "opening") await inventoryService.startDay(actor,operation);
    else if (operation.kind === "adjustment") await inventoryService.bulkUpdateCurrent(actor, operation);
    else await productService.restock(actor, operation.productId, operation.quantity);
    // A permanent receipt stores intent + compact acknowledgement, not a
    // copy of a 1,000-product report for every sale. Clients pull projections.
    return { status: 200, data: { operationId: operation.id, serverVersion: currentRevision(actor.userId) } };
  }, { operation: `inventory.${operation.kind}.v2`, payload: operation });
}
