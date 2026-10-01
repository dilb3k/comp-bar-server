import { Schema, model, models } from "mongoose";
import { serverVersionPlugin } from "../../lib/versioning";
const schema = new Schema({
  ownerAdminId: { type: String, required: true },
  localId: { type: String, required: true },
  productId: { type: String, required: true },
  deletedAt: { type: Date, default: Date.now },
}, { collection: "product_tombstones", versionKey: false });
schema.index({ ownerAdminId: 1, localId: 1 }, { unique: true });
schema.plugin(serverVersionPlugin);
// No TTL. A device offline for months cannot resurrect an intentionally deleted ID.
export const ProductTombstoneModel = models.ProductTombstone ?? model("ProductTombstone", schema);
