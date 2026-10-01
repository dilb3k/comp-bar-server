import { Schema, model, models } from "mongoose";

export interface IIdempotencyKey {
  ownerAdminId: string;
  key: string;
  fingerprint?: string;
  request?: unknown;
  state: "IN_PROGRESS" | "COMPLETED";
  responseStatus: number;
  responseBody: unknown;
  createdAt: Date;
}

const idempotencyKeySchema = new Schema<IIdempotencyKey>(
  {
    ownerAdminId: { type: String, required: true, index: true },
    key: { type: String, required: true },
    fingerprint: { type: String },
    request: { type: Schema.Types.Mixed },
    state: { type: String, enum: ["IN_PROGRESS", "COMPLETED"], default: "COMPLETED" },
    responseStatus: { type: Number },
    responseBody: { type: Schema.Types.Mixed },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "idempotency_keys", versionKey: false },
);

// Permanent operation receipts: a long-offline device must never replay a
// financial write just because a TTL elapsed.
idempotencyKeySchema.index({ ownerAdminId: 1, key: 1 }, { unique: true });
export const IdempotencyKeyModel =
  models.IdempotencyKey ?? model<IIdempotencyKey>("IdempotencyKey", idempotencyKeySchema);
