import { Schema, model, models } from "mongoose";

const schema = new Schema({
  tokenHash: { type: String, required: true, unique: true },
  startHash: { type: String, required: true, unique: true },
  telegramId: { type: String, default: null, index: true },
  telegramUsername: { type: String, default: null },
  phone: { type: String, default: null },
  consumed: { type: Boolean, default: false },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
}, { collection: "registration_phones", versionKey: false });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RegistrationPhoneModel = models.RegistrationPhone ?? model("RegistrationPhone", schema);
