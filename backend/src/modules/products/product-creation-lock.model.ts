import { Schema, model, models } from "mongoose";

// Closes the TOCTOU race on the 'bor' tier's 100-product cap: two concurrent
// "create product" requests for the same owner can each run their own
// transaction, each see countDocuments()=99 in their own snapshot (MongoDB
// transactions don't conflict on inserting two *distinct* new documents, only
// on writes to the *same* document — so a plain count-then-insert inside a
// transaction does not, by itself, serialize this), and both insert,
// landing the owner at 101. Acquiring this lock (a single document per
// owner, unique on _id) before the count-check+insert forces the second
// concurrent request to wait its turn instead.
//
// No persistent per-owner counter is used deliberately — that would need a
// migration to backfill every existing admin's current product count and
// careful upkeep on every create/delete path forever after, with real risk
// of drift (a wrong counter incorrectly blocking or under-blocking a paying
// customer) being a worse outcome than the rare race it replaces. This lock
// adds no new source of truth: the count check still queries the real
// products collection, just one request at a time per owner.
const productCreationLockSchema = new Schema(
  {
    _id: { type: String, required: true }, // ownerAdminId
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "product_creation_locks", versionKey: false },
);

// Safety net, not the primary release mechanism (that's the explicit
// deleteOne in product.service.ts's finally block) — if a process crashes
// while holding the lock, this guarantees it can't wedge a tenant's product
// creation shut forever.
productCreationLockSchema.index({ createdAt: 1 }, { expireAfterSeconds: 15 });

export const ProductCreationLockModel =
  models.ProductCreationLock ?? model("ProductCreationLock", productCreationLockSchema);
