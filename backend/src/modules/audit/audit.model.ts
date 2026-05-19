import { Schema, model, models } from "mongoose";

const auditEventSchema = new Schema(
  {
    ownerAdminId: {
      type: String,
      required: true,
      index: true,
    },
    action: {
      type: String,
      required: true,
      enum: ["CREATE", "UPDATE", "DELETE", "SYNC", "START_DAY"],
    },
    entityType: {
      type: String,
      required: true,
      enum: ["product", "inventory", "daily", "debtor", "sync"],
    },
    entityId: {
      type: String,
      required: true,
    },
    before: {
      type: Schema.Types.Mixed,
      default: null,
    },
    after: {
      type: Schema.Types.Mixed,
      default: null,
    },
    source: {
      type: String,
      required: true,
      enum: ["rest", "sync", "cron"],
    },
    createdBy: {
      type: String,
      required: true,
    },
  },
  {
    collection: "audit_events",
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  }
);

auditEventSchema.index({ ownerAdminId: 1, createdAt: -1 });
auditEventSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
auditEventSchema.index({ createdAt: -1 }, { expireAfterSeconds: 90 * 24 * 3600 });

export const AuditEventModel = models.AuditEvent ?? model("AuditEvent", auditEventSchema);
