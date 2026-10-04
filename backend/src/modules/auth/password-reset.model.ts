import { Schema, model, models } from "mongoose";

const schema = new Schema({
  userId: { type: String, required: true, index: true },
  telegramId: { type: String, required: true },
  securityVersion: { type: Number, required: true },
  tokenHash: { type: String, required: true, unique: true },
  purpose: { type: String, enum: ["web", "telegram"], default: "web" },
  consumed: { type: Boolean, default: false },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
}, { collection: "password_resets", versionKey: false });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const PasswordResetModel = models.PasswordReset ?? model("PasswordReset", schema);

/** Production disables autoIndex. Only provision this feature's new storage. */
export async function ensurePasswordResetStorage() {
  await PasswordResetModel.createCollection();
  await PasswordResetModel.createIndexes();
}
