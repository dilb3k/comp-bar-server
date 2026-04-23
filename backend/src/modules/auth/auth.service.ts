import { CatalogItemModel } from "../catalog/catalog-item.model";
import { DailySnapshotModel } from "../snapshots/snapshot.model";
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

    return authRepository.createUser({
      username: payload.username,
      password: payload.password,
      role: "admin",
      createdBy: actor.userId,
    });
  }

  async listAdmins(actor: AuthUser) {
    if (actor.role !== "superAdmin") {
      throw new AppError("Only superAdmin can view admins", 403);
    }

    return authRepository.listAdmins();
  }

  async findSuperAdmin() {
    return authRepository.findSuperAdmin();
  }

  async migrateLegacyOwnership(defaultOwnerAdminId: string) {
    await Promise.all([
      CatalogItemModel.updateMany(
        {
          $or: [
            { ownerAdminId: { $exists: false } },
            { ownerAdminId: null },
            { ownerAdminId: "" }
          ]
        },
        { $set: { ownerAdminId: defaultOwnerAdminId } }
      ),
      DailySnapshotModel.updateMany(
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
