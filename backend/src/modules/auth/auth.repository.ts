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
    payload: { username?: string; password?: string },
  ) {
    if (!Types.ObjectId.isValid(id)) return null;

    const update: Record<string, any> = {};
    if (payload.username) update.username = payload.username.trim().toLowerCase();
    if (payload.password) update.password = payload.password;

    return UserModel.findByIdAndUpdate(id, { $set: update }, { new: true });
  }

  async deleteAdmin(id: string) {
    if (!Types.ObjectId.isValid(id)) return null;
    return UserModel.findByIdAndUpdate(id, { $set: { isActive: false } }, { new: true });
  }
}

export const authRepository = new AuthRepository();
