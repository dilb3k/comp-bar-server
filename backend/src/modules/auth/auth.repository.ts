import { Types } from "mongoose";

import { UserModel } from "./user.model";

export class AuthRepository {
  async findByUsername(username: string) {
    return UserModel.findOne({ username: username.trim().toLowerCase() });
  }

  async findSuperAdmin() {
    return UserModel.findOne({ role: "superAdmin", isActive: true }).sort({
      createdAt: 1,
    });
  }

  async findById(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      return null;
    }

    return UserModel.findById(id);
  }

  async createUser(payload: {
    username: string;
    password: string;
    role: "admin" | "superAdmin";
    createdBy?: string | null;
  }) {
    return UserModel.create({
      username: payload.username.trim().toLowerCase(),
      password: payload.password,
      role: payload.role,
      createdBy: payload.createdBy ?? null,
    });
  }

  async listAdmins() {
    return UserModel.find({ role: "admin", isActive: true }).sort({
      createdAt: -1,
    });
  }

  async updateAdmin(
    id: string,
    payload: { username?: string; password?: string; isPayed?: boolean; businessDayStartHour?: number },
  ) {
    if (!Types.ObjectId.isValid(id)) return null;

    const user = await UserModel.findById(id);
    if (!user) return null;

    if (payload.username !== undefined) user.username = payload.username.trim().toLowerCase();
    if (payload.password !== undefined) user.password = payload.password;
    if (payload.isPayed !== undefined) user.isPayed = payload.isPayed;
    if (payload.businessDayStartHour !== undefined) (user as any).businessDayStartHour = payload.businessDayStartHour;

    return user.save();
  }

  async updateMe(
    id: string,
    payload: { businessDayStartHour?: number; pendingBusinessDayStartHour?: number | null; businessDayEffectiveFrom?: Date | null; blockCode?: string | null },
  ) {
    if (!Types.ObjectId.isValid(id)) return null;

    const user = await UserModel.findById(id);
    if (!user) return null;

    if (payload.businessDayStartHour !== undefined) {
      (user as any).businessDayStartHour = payload.businessDayStartHour;
    }
    if (payload.pendingBusinessDayStartHour !== undefined) {
      (user as any).pendingBusinessDayStartHour = payload.pendingBusinessDayStartHour;
    }
    if (payload.businessDayEffectiveFrom !== undefined) {
      (user as any).businessDayEffectiveFrom = payload.businessDayEffectiveFrom;
    }
    if (payload.blockCode !== undefined) {
      (user as any).blockCode = payload.blockCode;
    }

    return user.save();
  }

  async deleteAdmin(id: string) {
    if (!Types.ObjectId.isValid(id)) return null;
    return UserModel.findByIdAndUpdate(id, { $set: { isActive: false } }, { new: true });
  }
}

export const authRepository = new AuthRepository();
