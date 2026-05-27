import mongoose from "mongoose";
import { telegramReportService } from "../../services/telegram-report.service";
import { AppError } from "../../utils/app-error";
import { subscriptionService } from "../subscriptions/subscription.service";
import { computeTier } from "../subscriptions/subscription.model";
import { authRepository } from "./auth.repository";
import type { AuthUser } from "./auth.types";
import {signAccessToken } from "./auth.utils";

export class AuthService {
  async register(payload: { username: string; password: string }) {
    const existing = await authRepository.findByUsername(payload.username);

    if (existing) {
      throw new AppError("Username already exists", 409);
    }

    const superAdmin = await authRepository.findSuperAdmin();
    const hasSuperAdmin = !!superAdmin;

    const role = hasSuperAdmin ? "admin" : "superAdmin";

    const user = await authRepository.createUser({
      username: payload.username,
      password: payload.password,
      role: role as "admin" | "superAdmin",
      createdBy: null,
    });

    const isPayed = role === "superAdmin" ? true : false;
    const activeSub = await subscriptionService.getActiveSubscription(user._id.toString());
    const tier = computeTier(role, isPayed, activeSub);

    const authUser: AuthUser = {
      userId: user._id.toString(),
      username: user.username,
      role: user.role,
      isPayed,
      tier,
      subscriptionEndDate: activeSub?.endDate?.toISOString?.() ?? null,
      businessDayStartHour: (user as any).businessDayStartHour ?? 0,
      pendingBusinessDayStartHour: (user as any).pendingBusinessDayStartHour ?? null,
      businessDayEffectiveFrom: (user as any).businessDayEffectiveFrom?.toISOString?.() ?? null,
      blockCode: (user as any).blockCode ?? null
    };

    return {
      token: signAccessToken(authUser),
      user: { ...user.toJSON(), tier, subscriptionEndDate: activeSub?.endDate?.toISOString?.() ?? null }
    };
  }

  async login(username: string, password: string) {
    const user = await authRepository.findByUsername(username);

    if (!user || !user.isActive) {
      throw new AppError("Invalid username or password", 401);
    }

    const storedPassword = (user as any).password || "";
    const isBcryptHash = storedPassword.startsWith("$2a$") || storedPassword.startsWith("$2b$");

    let passwordIsValid = false;

    if (isBcryptHash) {
      passwordIsValid = await (user as any).comparePassword(password);
    } else {
      passwordIsValid = storedPassword === password;
      if (passwordIsValid) {
        (user as any).password = password;
        await (user as any).save();
      }
    }

    if (!passwordIsValid) {
      throw new AppError("Invalid username or password", 401);
    }


    await subscriptionService.refreshExpiredSubscriptions();

    const isPayed = user.role === "superAdmin" ? true : (user.isPayed ?? false);
    const activeSub = await subscriptionService.getActiveSubscription(user._id.toString());
    const tier = computeTier(user.role, isPayed, activeSub);

    const authUser: AuthUser = {
      userId: user._id.toString(),
      username: user.username,
      role: user.role,
      isPayed,
      tier,
      subscriptionEndDate: activeSub?.endDate?.toISOString?.() ?? null,
      businessDayStartHour: (user as any).businessDayStartHour ?? 0,
      pendingBusinessDayStartHour: (user as any).pendingBusinessDayStartHour ?? null,
      businessDayEffectiveFrom: (user as any).businessDayEffectiveFrom?.toISOString?.() ?? null,
      blockCode: (user as any).blockCode ?? null
    };

    return {
      token: signAccessToken(authUser),
      user: { ...user.toJSON(), tier, subscriptionEndDate: activeSub?.endDate?.toISOString?.() ?? null }
    };
  }

  async getCurrentUser(userId: string) {
    const user = await authRepository.findById(userId);

    if (!user || !user.isActive) {
      throw new AppError("User not found", 404);
    }

    await subscriptionService.refreshExpiredSubscriptions();

    const activeSub = await subscriptionService.getActiveSubscription(userId);
    const tier = computeTier(user.role, user.isPayed ?? false, activeSub);

    const userJson = user.toJSON();
    return {
      ...userJson,
      tier,
      subscriptionEndDate: activeSub?.endDate?.toISOString?.() ?? null,
    };
  }

  async createAdmin(
    actor: AuthUser,
    payload: {
      username: string;
      password: string;
      tier?: "tekin" | "bor" | "pro";
      isPayed?: boolean;
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

    const adminId = admin._id.toString();

    if (payload.tier === "pro") {
      await subscriptionService.activate(actor, adminId, "pro");
    } else if (payload.tier === "bor") {
      await subscriptionService.activate(actor, adminId, "bor");
    } else if (payload.tier === "tekin") {
      await authRepository.updateAdmin(adminId, { isPayed: false });
    } else if (payload.isPayed !== undefined) {
      await authRepository.updateAdmin(adminId, { isPayed: payload.isPayed });
    }

    telegramReportService.reportAdminCreated(actor, {
      username: (admin as any).username,
      role: (admin as any).role,
      createdBy: (admin as any).createdBy ?? actor.userId
    });

    return authRepository.findById(adminId);
  }

  async listAdmins(actor: AuthUser) {
    if (actor.role !== "superAdmin") {
      throw new AppError("Only superAdmin can view admins", 403);
    }

    const admins = await authRepository.listAdmins();
    const userIds = admins.map((a) => a._id.toString());
    const subMap = await subscriptionService.getActiveSubscriptions(userIds);

    return admins.map((admin) => {
      const adminId = admin._id.toString();
      const activeSub = subMap.get(adminId) ?? null;
      const tier = computeTier(admin.role, admin.isPayed ?? false, activeSub);
      const json = admin.toJSON();
      return {
        ...json,
        tier,
        subscriptionEndDate: activeSub?.endDate?.toISOString?.() ?? null,
      };
    });
  }

  async updateAdmin(
    actor: AuthUser,
    id: string,
    payload: { username?: string; password?: string; tier?: "tekin" | "bor" | "pro"; isPayed?: boolean }
  ) {
    if (actor.role !== "superAdmin") {
      throw new AppError("Only superAdmin can update admins", 403);
    }

    const existing = await authRepository.findById(id);
    if (!existing || !existing.isActive) {
      throw new AppError("User not found", 404);
    }

    if (actor.userId !== id && existing.role !== "admin") {
      throw new AppError("Can only update admin users", 400);
    }

    if (payload.username) {
      const duplicate = await authRepository.findByUsername(payload.username);
      if (duplicate && duplicate._id.toString() !== id) {
        throw new AppError("Username already exists", 409);
      }
    }

    if (payload.tier !== undefined) {
      if (payload.tier === "pro") {
        await subscriptionService.activate(actor, id, "pro");
      } else if (payload.tier === "bor") {
        await subscriptionService.activate(actor, id, "bor");
      } else {
        await subscriptionService.deactivate(actor, id);
        await authRepository.updateAdmin(id, { isPayed: false });
      }
    }

    if (payload.isPayed !== undefined) {
      await authRepository.updateAdmin(id, { isPayed: payload.isPayed });
    }

    const updated = await authRepository.updateAdmin(id, {
      username: payload.username,
      password: payload.password,
    });

    const activeSub = await subscriptionService.getActiveSubscription(id);
    const currentIsPayed = (updated as any)?.isPayed ?? existing.isPayed ?? false;
    const tier = computeTier(existing.role, currentIsPayed, activeSub);
    const json = updated?.toJSON() ?? {};
    return { ...json, tier, subscriptionEndDate: activeSub?.endDate?.toISOString?.() ?? null };
  }

  async updateMe(
    actor: AuthUser,
    payload: { businessDayStartHour?: number; blockCode?: string | null }
  ) {
    const repoPayload: Record<string, any> = {};
    const authUserUpdate: Record<string, any> = {};

    if (payload.businessDayStartHour !== undefined) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(payload.businessDayStartHour, 0, 0, 0);
      repoPayload.businessDayStartHour = actor.businessDayStartHour ?? 0;
      repoPayload.pendingBusinessDayStartHour = payload.businessDayStartHour;
      repoPayload.businessDayEffectiveFrom = tomorrow;
      authUserUpdate.pendingBusinessDayStartHour = payload.businessDayStartHour;
      authUserUpdate.businessDayEffectiveFrom = tomorrow.toISOString();
    }

    if (payload.blockCode !== undefined) {
      repoPayload.blockCode = payload.blockCode;
      authUserUpdate.blockCode = payload.blockCode;
    }

    const updated = await authRepository.updateMe(actor.userId, repoPayload);
    if (!updated) {
      throw new AppError("User not found", 404);
    }

    const activeSub = await subscriptionService.getActiveSubscription(actor.userId);
    const tier = computeTier(actor.role, actor.isPayed, activeSub);

    const updatedUser: AuthUser = {
      userId: actor.userId,
      username: actor.username,
      role: actor.role,
      isPayed: actor.isPayed,
      tier,
      subscriptionEndDate: activeSub?.endDate?.toISOString?.() ?? null,
      businessDayStartHour: actor.businessDayStartHour ?? 0,
      ...authUserUpdate,
    };

    return {
      user: updated.toJSON(),
      token: signAccessToken(updatedUser),
    };
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
    const orphanFilter = {
      $or: [
        { ownerAdminId: { $exists: false } },
        { ownerAdminId: null },
        { ownerAdminId: "" }
      ]
    };

    const needsMigration = await Promise.all([
      mongoose.connection.collection("products").countDocuments(orphanFilter),
      mongoose.connection.collection("inventory_entries").countDocuments(orphanFilter).catch(() => 0),
      mongoose.connection.collection("daily_snapshots").countDocuments(orphanFilter).catch(() => 0),
    ]);

    if (!needsMigration.some((count) => count > 0)) {
      return;
    }

    await Promise.all([
      mongoose.connection.collection("products").updateMany(orphanFilter, { $set: { ownerAdminId: defaultOwnerAdminId } }),
      mongoose.connection.collection("inventory_entries").updateMany(orphanFilter, { $set: { ownerAdminId: defaultOwnerAdminId } }).catch(() => {}),
      mongoose.connection.collection("daily_snapshots").updateMany(orphanFilter, { $set: { ownerAdminId: defaultOwnerAdminId } }).catch(() => {}),
    ]);
  }
}

export const authService = new AuthService();
