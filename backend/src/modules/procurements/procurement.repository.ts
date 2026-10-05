import { currentSession } from "../../lib/transaction";
import { ProcurementModel, serializeProcurement } from "./procurement.model";

export class ProcurementRepository {
  async findRange(ownerAdminId: string, from?: string, to?: string, options: { supplier?: string; product?: string; page?: number; limit?: number } = {}) {
    const filter: Record<string, unknown> = { ownerAdminId };
    if (from || to) {
      filter.date = {
        ...(from ? { $gte: from } : {}),
        ...(to ? { $lte: to } : {}),
      };
    }
    if (options.supplier) filter.supplier = options.supplier;
    if (options.product) filter["items.productId"] = options.product;
    const limit = Math.min(options.limit ?? 100, 100);
    const query = ProcurementModel.find(filter).sort({ date: -1, createdAt: -1, localId: -1 }).skip(((options.page ?? 1) - 1) * limit).limit(limit);
    const session = currentSession();
    if (session) query.session(session);
    return (await query.lean()).map(serializeProcurement);
  }
}

export const procurementRepository = new ProcurementRepository();
