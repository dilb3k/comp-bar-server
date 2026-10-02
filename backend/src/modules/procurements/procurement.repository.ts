import { currentSession } from "../../lib/transaction";
import { ProcurementModel } from "./procurement.model";

export class ProcurementRepository {
  async findRange(ownerAdminId: string, from?: string, to?: string) {
    const filter: Record<string, unknown> = { ownerAdminId };
    if (from || to) {
      filter.date = {
        ...(from ? { $gte: from } : {}),
        ...(to ? { $lte: to } : {}),
      };
    }
    const query = ProcurementModel.find(filter).sort({ date: -1, createdAt: -1 });
    const session = currentSession();
    if (session) query.session(session);
    return query;
  }
}

export const procurementRepository = new ProcurementRepository();
