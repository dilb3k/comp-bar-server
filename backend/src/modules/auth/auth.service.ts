import mongoose from "mongoose";

import { ProductModel } from "../products/product.model";
import { telegramReportService } from "../../services/telegram-report.service";
import { AppError } from "../../utils/app-error";
import { authRepository } from "./auth.repository";
import type { AuthUser } from "./auth.types";
import {signAccessToken } from "./auth.utils";

export class AuthService {
  async login(username: string, password: string) {
    const user = await authRepository.findByUsername(username);

    if (!user || !user.isActive) {
      throw new AppError("Invalid username or password", 401);
    }

    if (!password) {
      throw new AppError("Invalid username or password", 401);
    }

    const authUser: AuthUser = {
      userId: user._id.toString(),
      username: user.username,
      role: user.role
    };

    return {
      token: signAccessToken(authUser),
      user: user.toJSON()
    };
  }

  async getCurrentUser(userId: string) {
    const user = await authRepository.findById(userId);

    if (!user || !user.isActive) {
      throw new AppError("User not found", 404);
    }

    return user;
  }

  async createAdmin(
    actor: AuthUser,
    payload: {
      username: string;
      password: string;
    }
  ) {
    if (actor.role !== "superAdmin") {
      throw new AppError("Only superAdmin can create admins", 403);
    }

    const existing = await authRepository.findByUsername(payload.username);

    if (existing) {
      throw new AppError("Username already exists", 409);
    }

    const admin = await authRepository.createUser({
      username: payload.username,
      password: payload.password,
      role: "admin",
      createdBy: actor.userId,
    });

    telegramReportService.reportAdminCreated(actor, {
      username: (admin as any).username,
      role: (admin as any).role,
      createdBy: (admin as any).createdBy ?? actor.userId
    });

    return admin;
  }

  async listAdmins(actor: AuthUser) {
    if (actor.role !== "superAdmin") {
      throw new AppError("Only superAdmin can view admins", 403);
    }

    return authRepository.listAdmins();
  }

  async updateAdmin(
    actor: AuthUser,
    id: string,
    payload: { username?: string; password?: string }
  ) {
    if (actor.role !== "superAdmin") {
      throw new AppError("Only superAdmin can update admins", 403);
    }

    const existing = await authRepository.findById(id);
    if (!existing || !existing.isActive) {
      throw new AppError("User not found", 404);
    }

    if (existing.role !== "admin") {
      throw new AppError("Can only update admin users", 400);
    }

    if (payload.username) {
      const duplicate = await authRepository.findByUsername(payload.username);
      if (duplicate && duplicate._id.toString() !== id) {
        throw new AppError("Username already exists", 409);
      }
    }

    const updated = await authRepository.updateAdmin(id, payload);
    return updated;
  }

  async deleteAdmin(actor: AuthUser, id: string) {
    if (actor.role !== "superAdmin") {
      throw new AppError("Only superAdmin can delete admins", 403);
    }

    if (actor.userId === id) {
      throw new AppError("Cannot delete yourself", 400);
    }

    const existing = await authRepository.findById(id);
    if (!existing || !existing.isActive) {
      throw new AppError("User not found", 404);
    }

    if (existing.role !== "admin") {
      throw new AppError("Can only delete admin users", 400);
    }

    return authRepository.deleteAdmin(id);
  }

  async findSuperAdmin() {
    return authRepository.findSuperAdmin();
  }

  async migrateLegacyOwnership(defaultOwnerAdminId: string) {
    await Promise.all([
      ProductModel.updateMany(
        {
          $or: [
            { ownerAdminId: { $exists: false } },
            { ownerAdminId: null },
            { ownerAdminId: "" }
          ]
        },
        { $set: { ownerAdminId: defaultOwnerAdminId } }
      ),
      mongoose.connection.collection("catalog_items").updateMany(
        {
          $or: [
            { ownerAdminId: { $exists: false } },
            { ownerAdminId: null },
            { ownerAdminId: "" }
          ]
        },
        { $set: { ownerAdminId: defaultOwnerAdminId } }
      ),
      mongoose.connection.collection("dailysnapshots").updateMany(
        {
          $or: [
            { ownerAdminId: { $exists: false } },
            { ownerAdminId: null },
            { ownerAdminId: "" }
          ]
        },
        { $set: { ownerAdminId: defaultOwnerAdminId } }
      )
    ]);
  }
}

export const authService = new AuthService();
