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
    phone_number?: string;
    password: string;
    role: "admin" | "superAdmin";
    createdBy?: string | null;
    businessDayStartHour?: number;
  }) {
    return UserModel.create({
      username: payload.username.trim().toLowerCase(),
      phone_number: payload.phone_number?.trim() ?? "",
      password: payload.password,
      role: payload.role,
      createdBy: payload.createdBy ?? null,
      businessDayStartHour: payload.businessDayStartHour ?? 0,
    });
  }

  async listAdmins() {
    return UserModel.find({ role: "admin" }).sort({
      createdAt: -1,
    });
  }

  async updateAdmin(
    id: string,
    payload: { username?: string; phone_number?: string; password?: string; isPayed?: boolean; isActive?: boolean; businessDayStartHour?: number },
  ) {
    if (!Types.ObjectId.isValid(id)) return null;

    const user = await UserModel.findById(id);
    if (!user) return null;

    if (payload.username !== undefined) (user as any).username = payload.username.trim().toLowerCase();
    if (payload.phone_number !== undefined) user.phone_number = payload.phone_number.trim();
    if (payload.password !== undefined) user.password = payload.password;
    if (payload.isPayed !== undefined) user.isPayed = payload.isPayed;
    if (payload.isActive !== undefined) (user as any).isActive = payload.isActive;
    if (payload.businessDayStartHour !== undefined) (user as any).businessDayStartHour = payload.businessDayStartHour;

    return user.save();
  }

  async updateMe(
    id: string,
    payload: { username?: string; phone_number?: string; businessDayStartHour?: number; pendingBusinessDayStartHour?: number | null; businessDayEffectiveFrom?: Date | null; blockCode?: string | null; activeSessionId?: string | null },
  ) {
    if (!Types.ObjectId.isValid(id)) return null;

    const user = await UserModel.findById(id);
    if (!user) return null;

    if (payload.username !== undefined) {
      (user as any).username = payload.username.trim().toLowerCase();
    }
    if (payload.phone_number !== undefined) {
      user.phone_number = payload.phone_number.trim();
    }
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
    if (payload.activeSessionId !== undefined) {
      (user as any).activeSessionId = payload.activeSessionId;
    }

    return user.save();
  }

  async pushVerifiedDevice(id: string, deviceId: string) {
    if (!Types.ObjectId.isValid(id)) return null;
    return UserModel.updateOne(
      { _id: id, verifiedDeviceIds: { $ne: deviceId } },
      { $push: { verifiedDeviceIds: deviceId } },
    );
  }

  async deleteAdmin(id: string) {
    if (!Types.ObjectId.isValid(id)) return null;
    return UserModel.findByIdAndDelete(id);
  }
}

export const authRepository = new AuthRepository();
