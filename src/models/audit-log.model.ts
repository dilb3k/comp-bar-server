import { randomUUID } from "crypto";
import { model, Schema } from "mongoose";
import { AuditAction } from "../types/domain";

type AuditLogDocument = {
  id: string;
  workspaceId: string;
  actorId?: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  meta?: Record<string, unknown>;
  createdAt: Date;
  productId?: string;
  saleId?: string;
};

const auditLogSchema = new Schema<AuditLogDocument>(
  {
    id: { type: String, default: randomUUID, unique: true, index: true },
    workspaceId: { type: String, required: true, index: true },
    actorId: { type: String, required: false, index: true },
    action: {
      type: String,
      enum: ["USER_REGISTERED", "PRODUCT_CREATED", "PRODUCT_UPDATED", "SALE_CREATED"],
      required: true
    },
    entityType: { type: String, required: true },
    entityId: { type: String, required: true },
    meta: { type: Schema.Types.Mixed, required: false },
    productId: { type: String, required: false, index: true },
    saleId: { type: String, required: false, index: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ workspaceId: 1, createdAt: -1 });

export const AuditLogModel = model<AuditLogDocument>("AuditLog", auditLogSchema);
