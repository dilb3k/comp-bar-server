import { AppError } from "../../utils/app-error";
import { authRepository } from "../auth/auth.repository";
import type { AuthUser } from "../auth/auth.types";
import { auditService } from "../audit/audit.service";
import { SubscriptionModel, computeTier, type ISubscription, type SubscriptionTier } from "./subscription.model";

// Adds calendar months without JS Date's end-of-month overflow bug: plain
// `setMonth` on Jan 31 + 1 month lands on Mar 3 (January has no Feb 31 to
// land on, so it rolls over), silently handing out a few extra days
// depending purely on which day of the month a purchase happened to land on.
// Clamps to the target month's actual last day instead.
function addMonthsClamped(date: Date, months: number): Date {
  const result = new Date(date);
  const targetMonth = result.getMonth() + months;
  result.setMonth(targetMonth);
  if (result.getMonth() !== ((targetMonth % 12) + 12) % 12) {
    result.setDate(0); // rolls back to the last day of the intended month
  }
  return result;
}

export class SubscriptionService {
  async activate(actor: AuthUser, userId: string, tier: "bor" | "pro", durationMonths: number = 1) {
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

    if (![1, 6, 12].includes(durationMonths)) {
      durationMonths = 1;
    }

    return this.activateOrExtend({
      userId,
      tier,
      durationMonths: durationMonths as 1 | 6 | 12,
      activatedBy: actor.userId,
      source: "rest",
    });
  }

  // Same core effect as activate() above, but callable from a trusted
  // system context (the payments module, triggered by an approved Click or
  // manual-card payment) that has no superAdmin AuthUser to act as — the
  // real actor here is "a completed payment", recorded via `source` rather
  // than an audit `createdBy` user id impersonating a superAdmin.
  async activateFromPayment(userId: string, tier: "bor" | "pro", durationMonths: 1 | 6 | 12, source: string) {
    const user = await authRepository.findById(userId);
    if (!user || !user.isActive) {
      throw new AppError("User not found", 404);
    }
    // Same guard activate() enforces for a superAdmin-initiated change —
    // a bot payment must only ever touch a regular tenant ("admin")
    // account, never the platform superAdmin's own subscription record.
    if ((user as any).role !== "admin") {
      throw new AppError("Cannot manage superAdmin subscription", 400);
    }

    return this.activateOrExtend({ userId, tier, durationMonths, activatedBy: source, source: "bot" });
  }

  // Shared by activate()/activateFromPayment(): if the user already has an
  // active subscription, extend it from the LATER of (now, its current
  // endDate) instead of the old behavior of deactivating it and starting a
  // fresh one from `now` — an early renewal used to silently discard
  // whatever time was left already paid for. If there's no active
  // subscription (or a race takes it away between the read and the write
  // below), falls through to creating one; the schema's partial unique index
  // on {userId, isActive:true} is the real backstop if two of these run
  // concurrently for the same user — one create loses with E11000 and this
  // retries as an extend against whichever one won.
  private async activateOrExtend(input: {
    userId: string;
    tier: "bor" | "pro";
    durationMonths: 1 | 6 | 12;
    activatedBy: string;
    source: "rest" | "bot";
  }) {
    const { userId, tier, durationMonths, activatedBy, source } = input;

    for (let attempt = 0; attempt < 2; attempt++) {
      const now = new Date();
      const existing = await SubscriptionModel.findOne({ userId, isActive: true });

      if (existing) {
        const base = existing.endDate > now ? existing.endDate : now;
        const newEndDate = addMonthsClamped(base, durationMonths);
        const updated = await SubscriptionModel.findOneAndUpdate(
          { _id: existing._id, isActive: true },
          { $set: { tier, endDate: newEndDate, activatedBy } },
          { new: true },
        );

        if (updated) {
          await authRepository.updateAdmin(userId, { isPayed: true });
          await auditService.log({
            ownerAdminId: userId,
            action: "UPDATE",
            entityType: "subscription",
            entityId: `subscription-${userId}`,
            after: {
              tier,
              durationMonths,
              extended: true,
              previousEndDate: existing.endDate.toISOString(),
              endDate: newEndDate.toISOString(),
              source,
            },
            source,
            createdBy: activatedBy,
          });
          return updated.toJSON();
        }
        // Lost a race — the subscription we just read got deactivated
        // between the find and this update. Loop and re-read fresh state.
        continue;
      }

      try {
        const endDate = addMonthsClamped(now, durationMonths);
        const subscription = await SubscriptionModel.create({
          userId,
          tier,
          startDate: now,
          endDate,
          isActive: true,
          activatedBy,
        });

        await authRepository.updateAdmin(userId, { isPayed: true });

        await auditService.log({
          ownerAdminId: userId,
          action: "UPDATE",
          entityType: "subscription",
          entityId: `subscription-${userId}`,
          after: { tier, durationMonths, startDate: now.toISOString(), endDate: endDate.toISOString(), source },
          source,
          createdBy: activatedBy,
        });

        return subscription.toJSON();
      } catch (error: any) {
        if (error?.code === 11000) {
          // Another request created the active subscription between our
          // check above and this insert — loop once more to extend it
          // instead of erroring out.
          continue;
        }
        throw error;
      }
    }

    throw new AppError("Could not activate subscription — please try again", 409);
  }

  // System-context counterpart to deactivate() above, the same relationship
  // activateFromPayment has to activate() — called when a "provisioned"
  // (OCR-trusted, not yet admin-confirmed) payment gets rejected, either by
  // an admin tap or by the 48h auto-expire cron, and the tier granted on
  // trust has to come back off. No superAdmin AuthUser exists in either
  // caller, so this takes a plain userId + a source string for the audit
  // log instead.
  async deactivateFromPayment(userId: string, source: string) {
    const user = await authRepository.findById(userId);
    if (!user) {
      throw new AppError("User not found", 404);
    }

    await this.deactivateExisting(userId);

    await authRepository.updateAdmin(userId, { isPayed: false });

    await auditService.log({
      ownerAdminId: userId,
      action: "UPDATE",
      entityType: "subscription",
      entityId: `subscription-${userId}`,
      after: { tier: "tekin", active: false, source },
      source: "bot",
      createdBy: source,
    });

    return { deactivated: true };
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
      entityType: "subscription",
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

  // Subscriptions whose endDate falls within [now, now+daysAhead] — used by
  // the bot's daily reminder job so a business doesn't get silently
  // downgraded without warning (previously nothing notified a user their
  // subscription was about to lapse at all).
  //
  // Excludes subscriptions already reminded this period (reminderSentAt set
  // — see markReminderSent) so the daily cron doesn't re-match and re-DM the
  // same subscription on every run between now and its actual expiry.
  async findExpiringSoon(daysAhead: number) {
    const now = new Date();
    const until = new Date(now);
    until.setDate(until.getDate() + daysAhead);

    return SubscriptionModel.find({
      isActive: true,
      endDate: { $gte: now, $lte: until },
      reminderSentAt: null,
    }).sort({ endDate: 1 });
  }

  // Called by the bot right after it successfully DMs the expiry reminder.
  // Best-effort by design: if this call fails (bot restart, transient
  // network blip), the subscription simply gets re-matched and re-reminded
  // on the next daily run — a rare extra DM, not silence, which is the
  // safer failure mode for a "your subscription is expiring" notice.
  async markReminderSent(subscriptionId: string) {
    await SubscriptionModel.updateOne(
      { _id: subscriptionId },
      { $set: { reminderSentAt: new Date() } }
    );
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
    return subscription.toJSON();
  }

  private async deactivateExisting(userId: string) {
    await SubscriptionModel.updateMany(
      { userId, isActive: true },
      { $set: { isActive: false } }
    );
  }

  async getAllSubscriptions() {
    const subs = await SubscriptionModel.find({ isActive: true })
      .sort({ createdAt: -1 })
      .lean();
    return subs.map((s: any) => ({
      ...s,
      id: s._id?.toString(),
      _id: undefined,
    }));
  }
}

export const subscriptionService = new SubscriptionService();
