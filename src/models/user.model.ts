import { randomUUID } from "crypto";
import { model, Schema } from "mongoose";
import { UserRole } from "../types/domain";

type UserDocument = {
  id: string;
  workspaceId: string;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  createdAt: Date;
};

const userSchema = new Schema<UserDocument>(
  {
    id: { type: String, default: randomUUID, unique: true, index: true },
    workspaceId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["admin", "staff"], required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const UserModel = model<UserDocument>("User", userSchema);
