import mongoose from "mongoose";
import { env } from "../../config/env";
import { telegramReportService } from "../../services/telegram-report.service";
import { AppError } from "../../utils/app-error";
import { subscriptionService } from "../subscriptions/subscription.service";
import { computeTier, SubscriptionModel } from "../subscriptions/subscription.model";
import { authRepository } from "./auth.repository";
import { UserModel } from "./user.model";
import type { AuthUser } from "./auth.types";
import {signAccessToken } from "./auth.utils";

export class AuthService {
  async register(payload: { username: string; password: string; phone_number?: string }) {
    const existing = await authRepository.findByUsername(payload.username);

    if (existing) {
      throw new AppError("Username already exists", 409);
    }

    const superAdmin = await authRepository.findSuperAdmin();
    const hasSuperAdmin = !!superAdmin;

    // The very first account (bootstrap superAdmin) is always allowed. Once a
    // superAdmin exists, public self-registration can be disabled via the
    // ALLOW_PUBLIC_REGISTER env flag (kill-switch for production).
    if (hasSuperAdmin && !env.ALLOW_PUBLIC_REGISTER) {
      throw new AppError("Public registration is disabled", 403);
    }

    const role = hasSuperAdmin ? "admin" : "superAdmin";

    const user = await authRepository.createUser({
      username: payload.username,
      phone_number: payload.phone_number,
      password: payload.password,
      role: role as "admin" | "superAdmin",
      createdBy: null,
    });

    let isPayed = role === "superAdmin" ? true : false;
    let activeSub = await subscriptionService.getActiveSubscription(user._id.toString());

    // Give all new users a 10-minute trial subscription
    if (!activeSub) {
      const now = new Date();
      const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
      const sub = await subscriptionService.createTrialSubscription(user._id.toString(), "bor", now, endDate);
      isPayed = true;
      activeSub = sub;
    }

    const tier = computeTier(role, isPayed, activeSub);

    const authUser: AuthUser = {
      userId: user._id.toString(),
      username: (user as any).username,
      phone_number: user.phone_number,
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
      user: { ...user.toJSON(), isPayed, tier, subscriptionEndDate: activeSub?.endDate?.toISOString?.() ?? null }
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
      username: (user as any).username,
      phone_number: user.phone_number,
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
      phone_number?: string;
      password: string;
      tier?: "tekin" | "bor" | "pro";
      isPayed?: boolean;
      durationMonths?: number;
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
      phone_number: payload.phone_number,
      password: payload.password,
      role: "admin",
      createdBy: actor.userId,
    });

    const adminId = admin._id.toString();

    if (payload.tier === "pro") {
      await subscriptionService.activate(actor, adminId, "pro", payload.durationMonths);
    } else if (payload.tier === "bor") {
      await subscriptionService.activate(actor, adminId, "bor", payload.durationMonths);
    } else if (payload.tier === "tekin") {
      await authRepository.updateAdmin(adminId, { isPayed: false });
    } else if (payload.isPayed !== undefined) {
      await authRepository.updateAdmin(adminId, { isPayed: payload.isPayed });
    }

    telegramReportService.reportAdminCreated(actor, {
      username: (admin as any).username,
      phone_number: (admin as any).phone_number,
      role: (admin as any).role,
      createdBy: (admin as any).createdBy ?? actor.userId
    });

    const created = await authRepository.findById(adminId);
    return created?.toJSON() ?? null;
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
    payload: { username?: string; phone_number?: string; password?: string; tier?: "tekin" | "bor" | "pro"; isPayed?: boolean; durationMonths?: number }
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
        await subscriptionService.activate(actor, id, "pro", payload.durationMonths);
      } else if (payload.tier === "bor") {
        await subscriptionService.activate(actor, id, "bor", payload.durationMonths);
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
      phone_number: payload.phone_number,
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
    payload: { username?: string; phone_number?: string; businessDayStartHour?: number; blockCode?: string | null }
  ) {
    const repoPayload: Record<string, any> = {};
    const authUserUpdate: Record<string, any> = {};

    if (payload.username !== undefined) {
      const duplicate = await authRepository.findByUsername(payload.username);
      if (duplicate && duplicate._id.toString() !== actor.userId) {
        throw new AppError("Username already exists", 409);
      }
      repoPayload.username = payload.username;
      authUserUpdate.username = payload.username;
    }

    if (payload.phone_number !== undefined) {
      repoPayload.phone_number = payload.phone_number;
      authUserUpdate.phone_number = payload.phone_number;
    }

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
      username: authUserUpdate.username ?? actor.username,
      phone_number: authUserUpdate.phone_number ?? actor.phone_number,
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

    const deleted = await authRepository.deleteAdmin(id);
    return deleted?.toJSON() ?? null;
  }

  async findSuperAdmin() {
    const sa = await authRepository.findSuperAdmin();
    return sa?.toJSON() ?? null;
  }

  async getAdminStats(actor: AuthUser) {
    if (actor.role !== "superAdmin") {
      throw new AppError("Only superAdmin can view admin stats", 403);
    }

    const admins = await UserModel.find({ role: "admin", isActive: true })
      .sort({ createdAt: -1 })
      .lean();
    const userIds = admins.map((a) => String(a._id));
    const subs = await SubscriptionModel.find({
      userId: { $in: userIds },
      isActive: true,
      endDate: { $gte: new Date() },
    })
      .sort({ createdAt: -1 })
      .lean();
    const subMap = new Map<string, any>();
    for (const sub of subs) {
      const uid = String(sub.userId);
      if (!subMap.has(uid)) {
        subMap.set(uid, sub);
      }
    }

    const ProductModel = mongoose.connection.collection("products");
    const InventoryModel = mongoose.connection.collection("inventory_entries");
    const SnapshotModel = mongoose.connection.collection("daily_snapshots");

    const adminStats = await Promise.all(
      admins.map(async (admin: any) => {
        const adminId = String(admin._id);
        const activeSub = subMap.get(adminId) ?? null;
        const tier = computeTier(admin.role, admin.isPayed ?? false, activeSub);

        const [productCount, inventoryCount, snapshotAgg, lastActivity] = await Promise.all([
          ProductModel.countDocuments({ ownerAdminId: adminId }),
          InventoryModel.countDocuments({ ownerAdminId: adminId }),
          SnapshotModel.aggregate([
            { $match: { ownerAdminId: adminId } },
            {
              $group: {
                _id: null,
                totalRevenue: { $sum: "$totalRevenue" },
                totalProfit: { $sum: "$totalProfit" },
                totalSoldItems: { $sum: "$totalSoldItems" },
              },
            },
          ]).toArray(),
          Promise.all([
            ProductModel.find({ ownerAdminId: adminId }).sort({ updatedAt: -1 }).limit(1).project({ updatedAt: 1 }).next().catch(() => null),
            InventoryModel.find({ ownerAdminId: adminId }).sort({ updatedAt: -1 }).limit(1).project({ updatedAt: 1 }).next().catch(() => null),
            SnapshotModel.find({ ownerAdminId: adminId }).sort({ updatedAt: -1 }).limit(1).project({ updatedAt: 1 }).next().catch(() => null),
          ]).then((results) => {
            const dates = results
              .filter(Boolean)
              .map((r: any) => new Date(r.updatedAt).getTime());
            return dates.length > 0 ? new Date(Math.max(...dates)).toISOString() : null;
          }),
        ]);

        const topProducts = await SnapshotModel.aggregate([
          { $match: { ownerAdminId: adminId } },
          { $unwind: "$items" },
          {
            $group: {
              _id: "$items.productId",
              productName: { $first: "$items.productName" },
              totalSold: { $sum: "$items.sold" },
              totalRevenue: { $sum: "$items.revenue" },
              totalProfit: { $sum: "$items.profit" },
            },
          },
          { $sort: { totalSold: -1 } },
          { $limit: 5 },
        ]);

        return {
          id: String(admin._id),
          username: admin.username,
          phone_number: admin.phone_number ?? "",
          role: admin.role,
          createdBy: admin.createdBy ? String(admin.createdBy) : null,
          isActive: admin.isActive ?? true,
          isPayed: admin.isPayed ?? false,
          businessDayStartHour: admin.businessDayStartHour ?? 0,
          pendingBusinessDayStartHour: admin.pendingBusinessDayStartHour ?? null,
          businessDayEffectiveFrom: admin.businessDayEffectiveFrom ?? null,
          blockCode: admin.blockCode ?? null,
          createdAt: admin.createdAt ? admin.createdAt.toISOString() : null,
          updatedAt: admin.updatedAt ? admin.updatedAt.toISOString() : null,
          tier,
          subscriptionEndDate: activeSub?.endDate
            ? new Date(activeSub.endDate).toISOString()
            : null,
          daysRemaining: activeSub
            ? Math.ceil(
                (new Date(activeSub.endDate).getTime() - Date.now()) /
                  (1000 * 60 * 60 * 24),
              )
            : 0,
          productCount: productCount ?? 0,
          inventoryCount: inventoryCount ?? 0,
          totalRevenue: snapshotAgg[0]?.totalRevenue ?? 0,
          totalProfit: snapshotAgg[0]?.totalProfit ?? 0,
          totalSoldItems: snapshotAgg[0]?.totalSoldItems ?? 0,
          lastActive: lastActivity,
          topProducts: topProducts.map((p: any) => ({
            productId: p._id,
            name: p.productName,
            totalSold: p.totalSold,
            totalRevenue: p.totalRevenue,
            totalProfit: p.totalProfit,
          })),
        };
      }),
    );

    const totals = adminStats.reduce(
      (acc, a) => ({
        totalProducts: acc.totalProducts + a.productCount,
        totalRevenue: acc.totalRevenue + a.totalRevenue,
        totalProfit: acc.totalProfit + a.totalProfit,
        totalSoldItems: acc.totalSoldItems + a.totalSoldItems,
        activeSubscriptions: acc.activeSubscriptions + (a.daysRemaining > 0 ? 1 : 0),
      }),
      { totalProducts: 0, totalRevenue: 0, totalProfit: 0, totalSoldItems: 0, activeSubscriptions: 0 },
    );

    return { admins: adminStats, totals };
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
