import { Schema, model, models } from "mongoose";

// Stores the outcome of a client-supplied idempotencyKey so a retried
// mutating request (offline queue flush after a reconnect, this app's own
// client-side failover retry, a double-tapped "send") replays the original
// result instead of re-applying the operation — the whole point being a
// sale/stock-adjustment/receipt can't get recorded twice from one real user
// action. TTL'd: this is a short-lived dedup window, not an audit trail (the
// audit log already exists for that).
export interface IIdempotencyKey {
  ownerAdminId: string;
  key: string;
  responseStatus: number;
  responseBody: unknown;
  createdAt: Date;
}

const idempotencyKeySchema = new Schema<IIdempotencyKey>(
  {
    ownerAdminId: { type: String, required: true, index: true },
    key: { type: String, required: true },
    responseStatus: { type: Number, required: true },
    responseBody: { type: Schema.Types.Mixed, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "idempotency_keys", versionKey: false },
);

// One entry per (owner, key) — the unique index IS the concurrency guard: two
// racing requests with the same key both try to insert, the loser gets
// E11000 and reads back the winner's already-stored result instead.
idempotencyKeySchema.index({ ownerAdminId: 1, key: 1 }, { unique: true });
// 48h TTL — long enough to cover a realistic offline-queue backlog (a device
// gone all weekend) without this collection growing forever.
idempotencyKeySchema.index({ createdAt: 1 }, { expireAfterSeconds: 48 * 60 * 60 });

export const IdempotencyKeyModel =
  models.IdempotencyKey ?? model<IIdempotencyKey>("IdempotencyKey", idempotencyKeySchema);
