import { AppError } from "../../utils/app-error";
import { authRepository } from "../auth/auth.repository";
import type { AuthUser } from "../auth/auth.types";
import { auditService } from "../audit/audit.service";
import { SubscriptionModel, computeTier, type ISubscription, type SubscriptionTier } from "./subscription.model";

export class SubscriptionService {
  async activate(actor: AuthUser, userId: string, tier: "bor" | "pro") {
    if (actor.role !== "superAdmin") {
      throw new AppError("Only superAdmin can manage subscriptions", 403);
    }

    const user = await authRepository.findById(userId);
    if (!user || !user.isActive) {
      throw new AppError("User not found", 404);
    }
    if (user.role !== "admin") {
      throw new AppError("Cannot manage superAdmin subscription", 400);
    }

    const now = new Date();
    const endDate = new Date(now);
    endDate.setMonth(endDate.getMonth() + 1);

    await this.deactivateExisting(userId);

    const subscription = await SubscriptionModel.create({
      userId,
      tier,
      startDate: now,
      endDate,
      isActive: true,
      activatedBy: actor.userId,
    });

    await authRepository.updateAdmin(userId, { isPayed: true });

    await auditService.log({
      ownerAdminId: userId,
      action: "UPDATE",
      entityType: "product",
      entityId: `subscription-${userId}`,
      after: { tier, startDate: now.toISOString(), endDate: endDate.toISOString() },
      source: "rest",
      createdBy: actor.userId,
    });

    return subscription;
  }

  async deactivate(actor: AuthUser, userId: string) {
    if (actor.role !== "superAdmin") {
      throw new AppError("Only superAdmin can manage subscriptions", 403);
    }

    const user = await authRepository.findById(userId);
    if (!user || !user.isActive) {
      throw new AppError("User not found", 404);
    }

    await this.deactivateExisting(userId);

    await authRepository.updateAdmin(userId, { isPayed: false });

    await auditService.log({
      ownerAdminId: userId,
      action: "UPDATE",
      entityType: "product",
      entityId: `subscription-${userId}`,
      after: { tier: "tekin", active: false },
      source: "rest",
      createdBy: actor.userId,
    });

    return { deactivated: true };
  }

  async getActiveSubscription(userId: string): Promise<ISubscription | null> {
    const sub = await SubscriptionModel.findOne({
      userId,
      isActive: true,
      endDate: { $gte: new Date() },
    }).sort({ createdAt: -1 });

    return sub;
  }

  async getActiveSubscriptions(userIds: string[]): Promise<Map<string, ISubscription>> {
    const subs = await SubscriptionModel.find({
      userId: { $in: userIds },
      isActive: true,
      endDate: { $gte: new Date() },
    }).sort({ createdAt: -1 });

    const map = new Map<string, ISubscription>();
    for (const sub of subs) {
      const uid = sub.userId.toString();
      if (!map.has(uid)) {
        map.set(uid, sub);
      }
    }
    return map;
  }

  async refreshExpiredSubscriptions(): Promise<number> {
    const now = new Date();
    const expired = await SubscriptionModel.find({
      isActive: true,
      endDate: { $lt: now },
    });

    let count = 0;
    for (const sub of expired) {
      sub.isActive = false;
      await sub.save();
      await authRepository.updateAdmin(sub.userId, { isPayed: false });
      count++;
    }

    return count;
  }

  async getUserTier(
    userId: string,
    role: string,
    isPayed: boolean
  ): Promise<{ tier: SubscriptionTier; subscription: ISubscription | null }> {
    const activeSubscription = await this.getActiveSubscription(userId);
    const tier = computeTier(role, isPayed, activeSubscription);
    return { tier, subscription: activeSubscription };
  }

  async createTrialSubscription(userId: string, tier: "bor" | "pro", startDate: Date, endDate: Date) {
    const subscription = await SubscriptionModel.create({
      userId,
      tier,
      startDate,
      endDate,
      isActive: true,
      activatedBy: userId,
    });
    await authRepository.updateAdmin(userId, { isPayed: true });
    return subscription;
  }

  private async deactivateExisting(userId: string) {
    await SubscriptionModel.updateMany(
      { userId, isActive: true },
      { $set: { isActive: false } }
    );
  }

  async getAllSubscriptions() {
    return SubscriptionModel.find({ isActive: true })
      .sort({ createdAt: -1 })
      .populate("userId", "phone_number");
  }
}

export const subscriptionService = new SubscriptionService();
