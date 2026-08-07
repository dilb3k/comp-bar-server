import { AuditEventModel } from "./audit.model";

type AuditLogInput = {
  ownerAdminId: string;
  action: "CREATE" | "UPDATE" | "DELETE" | "SYNC" | "START_DAY" | "RESTOCK";
  entityType: "product" | "inventory" | "daily" | "debtor" | "sync" | "subscription";
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  source: "rest" | "sync" | "cron" | "bot";
  createdBy: string;
};

class AuditService {
  async log(input: AuditLogInput) {
    try {
      await AuditEventModel.create({
        ownerAdminId: input.ownerAdminId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        before: input.before ?? null,
        after: input.after ?? null,
        source: input.source,
        createdBy: input.createdBy,
      });
    } catch {
      // audit log failure should never break the main operation
    }
  }

  async findByOwner(ownerAdminId: string, limit = 100, skip = 0) {
    return AuditEventModel.find({ ownerAdminId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
  }

  async findByEntity(entityType: string, entityId: string, limit = 100) {
    return AuditEventModel.find({ entityType, entityId })
      .sort({ createdAt: -1 })
      .limit(limit);
  }
}

export const auditService = new AuditService();
