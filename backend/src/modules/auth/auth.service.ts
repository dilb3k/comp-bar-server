import { currentSession, withOwnerTransaction } from "../../lib/transaction";
import mongoose from "mongoose";
import { env } from "../../config/env";
import { telegramReportService } from "../../services/telegram-report.service";
import { AppError } from "../../utils/app-error";
import { getNextBusinessDayStart } from "../../utils/business-day";
import { subscriptionService } from "../subscriptions/subscription.service";
import { computeTier, SubscriptionModel } from "../subscriptions/subscription.model";
import { authRepository } from "./auth.repository";
import { UserModel } from "./user.model";
import { SessionChallengeModel } from "./session-challenge.model";
import { sendOtpViaTelegram } from "./otp-telegram";
import { alertService } from "../../services/alert.service";
import { ProductModel as ProductMongooseModel } from "../products/product.model";
import { InventoryEntryModel } from "../inventory/inventory.model";
import { DailySnapshotModel as SnapshotMongooseModel } from "../snapshots/snapshot.model";
import { DebtorModel } from "../debtors/debtor.model";
import { AuditEventModel } from "../audit/audit.model";
import type { AuthUser } from "./auth.types";
import {
  createSessionId,
  generateOtpCode,
  hashOtp,
  maskPhone,
  normalizePhone,
  phoneVerificationRequired,
  shouldClearActiveSession,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "./auth.utils";

const OTP_TTL_MS = 3 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 3;

export class AuthService {
  private async issueSession(user: any, deviceId?: string | null) {
    const sessionId = createSessionId();
    const updated = await UserModel.findOneAndUpdate({
      _id:user._id, isActive:true, password:user.password,
      activeSessionId: user.activeSessionId ?? null,
      $or:[{securityVersion:Number(user.securityVersion??0)}, ...(Number(user.securityVersion??0)===0?[{securityVersion:{$exists:false}}]:[])],
    }, { $set:{activeSessionId:sessionId}, ...(deviceId?{$addToSet:{verifiedDeviceIds:deviceId}}:{}) }, {session:currentSession(),new:true});
    if(!updated) throw new AppError("Hisob xavfsizlik sozlamalari o‘zgardi; qayta kiring",401);
    return sessionId;
  }

  private buildAuthUser(user: any, isPayed: boolean, tier: any, activeSub: any, sessionId?: string): AuthUser {
    return {
      userId: user._id.toString(),
      securityVersion: Number(user.securityVersion??0),
      username: (user as any).username,
      phone_number: user.phone_number,
      role: user.role,
      isPayed,
      tier,
      subscriptionEndDate: activeSub?.endDate?.toISOString?.() ?? null,
      businessDayStartHour: (user as any).businessDayStartHour ?? 0,
      pendingBusinessDayStartHour: (user as any).pendingBusinessDayStartHour ?? null,
      businessDayEffectiveFrom: (user as any).businessDayEffectiveFrom?.toISOString?.() ?? null,
      blockCode: (user as any).blockCode ?? null,
      sessionId,
    };
  }

  private async addVerifiedDevice(userId: string, deviceId?: string | null) {
    if (!deviceId) return;
    await authRepository.pushVerifiedDevice(userId, deviceId);
  }

  async register(payload: { username: string; password: string; phone_number?: string; businessDayStartHour?: number }) {
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
      businessDayStartHour: payload.businessDayStartHour,
    });

    let isPayed = role === "superAdmin" ? true : false;
    let activeSub = await subscriptionService.getActiveSubscription(user._id.toString());

    // Give all new users a 7-day trial subscription
    if (!activeSub) {
      const now = new Date();
      const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
      const sub = await subscriptionService.createTrialSubscription(user._id.toString(), "bor", now, endDate);
      isPayed = true;
      activeSub = sub;
    }

    const tier = computeTier(role, isPayed, activeSub);

    const sessionId = await this.issueSession(user);

    const authUser: AuthUser = this.buildAuthUser(user, isPayed, tier, activeSub, sessionId);

    return {
      token: signAccessToken(authUser),
      refreshToken: signRefreshToken({ userId: user._id.toString(), sessionId }),
      user: { ...user.toJSON(), isPayed, tier, subscriptionEndDate: activeSub?.endDate?.toISOString?.() ?? null }
    };
  }

  async login(username: string, password: string, deviceId?: string) {
    const user = await authRepository.findByUsername(username);

    if (!user || !user.isActive) {
      throw new AppError("Invalid username or password", 401);
    }

    const passwordIsValid = await (user as any).comparePassword(password);

    if (!passwordIsValid) {
      throw new AppError("Invalid username or password", 401);
    }

    // Any active session takeover requires out-of-band confirmation;
    // a remembered, client-supplied device ID cannot waive the challenge.
    if (phoneVerificationRequired(user, deviceId)) {
      const telegramId = (user as any).telegramId as string | null | undefined;

      // Real OTP path — only possible for a user who has linked Telegram
      // (via hisvex-bot's /start), since a bot can only DM someone who has
      // started a conversation with it and no SMS gateway exists in this
      // codebase. Missing linkage fails closed, without phone-retype bypass.
      if (telegramId) {
        const code = generateOtpCode();
        const challenge = await SessionChallengeModel.create({
          userId: user._id.toString(),
          otpHash: hashOtp(code),
          securityVersion: Number(user.securityVersion ?? 0),
          deviceId: deviceId ?? null,
          expiresAt: new Date(Date.now() + OTP_TTL_MS),
        });

        const sent = await sendOtpViaTelegram(telegramId, code);
        if (sent) {
          return {
            requiresVerification: true,
            verificationType: "PHONE_OTP",
            sessionChallengeId: challenge._id.toString(),
            message: "Akkaunt boshqa qurilmada faol. Davom etish uchun Telegramga yuborilgan kodni tasdiqlang.",
          };
        }
        // Telegram send failed (bot blocked, transient API error, ...) —
        // don't strand the user with a challenge id that can never be
        // fulfilled; clean it up and require a later OTP delivery retry.
        await SessionChallengeModel.deleteOne({ _id: challenge._id });
        throw new AppError("Telegram kodi yetkazilmadi. Keyinroq qayta urinib ko‘ring",503,undefined,"OTP_DELIVERY_FAILED");
      }

      throw new AppError("Telefon egaligini Telegram botidagi kontakt yuborish orqali tasdiqlang yoki administratorga murojaat qiling",403,undefined,"PHONE_OWNERSHIP_REQUIRED");
    }





    const isPayed = user.role === "superAdmin" ? true : (user.isPayed ?? false);
    const activeSub = await subscriptionService.getActiveSubscription(user._id.toString());
    const tier = computeTier(user.role, isPayed, activeSub);

    const sessionId = await this.issueSession(user,deviceId);

    const authUser: AuthUser = this.buildAuthUser(user, isPayed, tier, activeSub, sessionId);

    return {
      token: signAccessToken(authUser),
      refreshToken: signRefreshToken({ userId: user._id.toString(), sessionId }),
      user: { ...user.toJSON(), tier, subscriptionEndDate: activeSub?.endDate?.toISOString?.() ?? null }
    };
  }

  // Deliberately NOT a variant of login()/issueSession(): this must never
  // read or touch activeSessionId, so the real device's session (and its
  // already-issued token) keeps working completely untouched no matter how
  // many procurement-scope logins happen afterward. Same credential check
  // as login(), but the two paths otherwise don't interact at all.
  async loginAsProcurementAgent(username: string, password: string) {
    const user = await authRepository.findByUsername(username);

    if (!user || !user.isActive) {
      throw new AppError("Invalid username or password", 401);
    }

    const passwordIsValid = await (user as any).comparePassword(password);
    if (!passwordIsValid) {
      throw new AppError("Invalid username or password", 401);
    }

    const isPayed = user.role === "superAdmin" ? true : (user.isPayed ?? false);
    const activeSub = await subscriptionService.getActiveSubscription(user._id.toString());
    const tier = computeTier(user.role, isPayed, activeSub);

    const authUser: AuthUser = {
      ...this.buildAuthUser(user, isPayed, tier, activeSub, undefined),
      scope: "procurement",
    };

    return {
      token: signAccessToken(authUser, "12h"),
      user: { ...user.toJSON(), blockCode: null, tier, subscriptionEndDate: activeSub?.endDate?.toISOString?.() ?? null, scope: "procurement", capabilityRole: "PROCUREMENT_AGENT" },
    };
  }

  async loginWithPhoneVerification(username: string, password: string, _phone_number: string, deviceId?: string) {
    // Compatibility alias: the exact same challenge policy applies here.
    return this.login(username, password, deviceId);
  }

  // Completes the OTP path login() started above. Atomic claim on both the
  // attempt-increment (wrong code) and the consume (right code) so two
  // concurrent verify calls for the same challenge (a retried request,
  // double-tap) can't each count as a fresh attempt against the 3-try limit
  // or both succeed in issuing a session.
  async verifySessionChallenge(sessionChallengeId: string, otpCode: string, deviceId?: string) {
    const challenge = await SessionChallengeModel.findById(sessionChallengeId);

    if (!challenge || challenge.consumed || challenge.expiresAt.getTime() < Date.now()) {
      throw new AppError("Kod muddati tugagan yoki yaroqsiz. Qaytadan kiring.", 410);
    }

    if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
      throw new AppError("Urinishlar soni tugadi. Qaytadan kiring.", 429);
    }

    if (hashOtp(otpCode) !== challenge.otpHash) {
      const updated = await SessionChallengeModel.findOneAndUpdate(
        { _id: challenge._id, consumed: false, attempts:{$lt:OTP_MAX_ATTEMPTS}, expiresAt:{$gt:new Date()} },
        { $inc: { attempts: 1 } },
        { new: true },
      );
      const attemptsLeft = Math.max(0, OTP_MAX_ATTEMPTS - (updated?.attempts ?? challenge.attempts + 1));
      if (attemptsLeft <= 0) {
        throw new AppError("Urinishlar soni tugadi. Qaytadan kiring.", 429);
      }
      throw new AppError(`Kod noto'g'ri. Qolgan urinishlar: ${attemptsLeft}`, 401);
    }

    if (challenge.deviceId && challenge.deviceId !== deviceId) throw new AppError("Kod boshqa qurilma uchun yaratilgan",403);
    return withOwnerTransaction(challenge.userId, async () => {
    const claimed = await SessionChallengeModel.findOneAndUpdate(
      { _id: challenge._id, consumed: false, attempts:{$lt:OTP_MAX_ATTEMPTS}, expiresAt:{$gt:new Date()} },
      { $set: { consumed: true } },
      { new: true, session:currentSession() },
    );
    if (!claimed) {
      // Lost a race to a concurrent verify of the same (correct) code —
      // whichever call landed first already has a live session for this
      // user; this one has nothing left to do.
      throw new AppError("Bu kod allaqachon ishlatilgan.", 409);
    }

    const user = await authRepository.findById(challenge.userId);
    if (!user || !user.isActive) {
      throw new AppError("User not found", 404);
    }

    // Verified — trust this device going forward (matches
    // loginWithPhoneVerification's existing behavior) and take over the
    // session. issueSession() overwrites activeSessionId, which is exactly
    // what makes the old device's next authenticated request fail with
    // SESSION_REPLACED (auth.middleware.ts) — no separate "kick" step
    // needed.
    if (challenge.securityVersion !== Number(user.securityVersion ?? 0)) throw new AppError("Kod parol almashtirilishidan oldin yaratilgan",410);



    const isPayed = user.role === "superAdmin" ? true : (user.isPayed ?? false);
    const activeSub = await subscriptionService.getActiveSubscription(user._id.toString());
    const tier = computeTier(user.role, isPayed, activeSub);

    const sessionId = await this.issueSession(user,challenge.deviceId);
    const authUser: AuthUser = this.buildAuthUser(user, isPayed, tier, activeSub, sessionId);

    alertService.reportSessionTakeover({ username: (user as any).username });

    return {
      token: signAccessToken(authUser),
      refreshToken: signRefreshToken({ userId: user._id.toString(), sessionId }),
      user: { ...user.toJSON(), tier, subscriptionEndDate: activeSub?.endDate?.toISOString?.() ?? null }
    };
    });
  }

  async logout(userId: string, sessionId?: string) {
    if (!sessionId) return;
    await UserModel.updateOne({_id:userId,activeSessionId:sessionId},{$set:{activeSessionId:createSessionId()}});
  }

  async getCurrentUser(userId: string) {
    const user = await authRepository.findById(userId);

    if (!user || !user.isActive) {
      throw new AppError("User not found", 404);
    }



    const activeSub = await subscriptionService.getActiveSubscription(userId);
    const tier = computeTier(user.role, user.isPayed ?? false, activeSub);

    const userJson = user.toJSON();
    return {
      ...userJson,
      tier,
      subscriptionEndDate: activeSub?.endDate?.toISOString?.() ?? null,
    };
  }

  async refresh(token: string) {
    let decoded: { userId: string; sessionId?: string };
    try {
      decoded = verifyRefreshToken(token);
    } catch {
      throw new AppError("Invalid or expired refresh token", 401);
    }

    const user = await authRepository.findById(decoded.userId);
    if (!user || !user.isActive) {
      throw new AppError("User not found", 404);
    }

    // Session was replaced by another login → this refresh token is dead.
    const activeId = (user as any).activeSessionId;
    if (activeId ? decoded.sessionId !== activeId : decoded.sessionId) {
      throw new AppError("Boshqa qurilmadan kirish tasdiqlangani sababli ushbu sessiya yakunlandi.", 401, undefined, "SESSION_REPLACED");
    }



    const isPayed = user.role === "superAdmin" ? true : (user.isPayed ?? false);
    const activeSub = await subscriptionService.getActiveSubscription(user._id.toString());
    const tier = computeTier(user.role, isPayed, activeSub);

    const authUser: AuthUser = this.buildAuthUser(user, isPayed, tier, activeSub, decoded.sessionId);

    return {
      token: signAccessToken(authUser),
      refreshToken: signRefreshToken({ userId: user._id.toString(), sessionId: decoded.sessionId }),
      user: { ...user.toJSON(), tier, subscriptionEndDate: activeSub?.endDate?.toISOString?.() ?? null }
    };
  }

  async createAdmin(
    actor: AuthUser,
    payload: {
      username: string;
      phone_number: string;
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
    payload: { username?: string; phone_number?: string; password?: string; tier?: "tekin" | "bor" | "pro"; isPayed?: boolean; isActive?: boolean; durationMonths?: number }
  ) {
    if (actor.role !== "superAdmin") {
      throw new AppError("Only superAdmin can update admins", 403);
    }

    const existing = await authRepository.findById(id);
    if (!existing) {
      throw new AppError("User not found", 404);
    }

    if (actor.userId !== id && existing.role !== "admin") {
      throw new AppError("Can only update admin users", 400);
    }

    if (payload.isActive === false && actor.userId === id) {
      throw new AppError("Cannot deactivate yourself", 400);
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
      isActive: payload.isActive,
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
      const tomorrow = getNextBusinessDayStart(
        payload.businessDayStartHour,
        env.TIMEZONE_OFFSET
      );
      // Only the pending pair is written — the change deliberately takes effect
      // tomorrow, so today's already-open business day keeps its boundary and
      // today's sales don't get re-attributed mid-day. auth.middleware.ts
      // promotes pending → businessDayStartHour once `tomorrow` arrives; the
      // active hour must NOT be touched here (rewriting it with its own current
      // value was pointless churn, and reset it to 0 whenever the actor's hour
      // was unset).
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
      securityVersion: actor.securityVersion??0,
      username: authUserUpdate.username ?? actor.username,
      phone_number: authUserUpdate.phone_number ?? actor.phone_number,
      role: actor.role,
      isPayed: actor.isPayed,
      tier,
      subscriptionEndDate: activeSub?.endDate?.toISOString?.() ?? null,
      businessDayStartHour: actor.businessDayStartHour ?? 0,
      sessionId: actor.sessionId,
      ...authUserUpdate,
    };

    return {
      user: updated.toJSON(),
      token: signAccessToken(updatedUser),
      refreshToken: signRefreshToken({ userId: actor.userId, sessionId: actor.sessionId }),
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
    if (!existing) {
      throw new AppError("User not found", 404);
    }

    if (existing.role !== "admin") {
      throw new AppError("Can only delete admin users", 400);
    }

    const adminId = existing._id.toString();

    await Promise.all([
      ProductMongooseModel.deleteMany({ ownerAdminId: adminId }),
      InventoryEntryModel.deleteMany({ ownerAdminId: adminId }),
      SnapshotMongooseModel.deleteMany({ ownerAdminId: adminId }),
      SubscriptionModel.deleteMany({ userId: adminId }),
      DebtorModel.deleteMany({ createdBy: adminId }),
      AuditEventModel.deleteMany({ ownerAdminId: adminId }),
    ]);

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

    const productModel = ProductMongooseModel;
    const inventoryModel = InventoryEntryModel;
    const snapshotModel = SnapshotMongooseModel;

    const adminStats = await Promise.all(
      admins.map(async (admin: any) => {
        const adminId = String(admin._id);
        const activeSub = subMap.get(adminId) ?? null;
        const tier = computeTier(admin.role, admin.isPayed ?? false, activeSub);

        const [productCount, inventoryCount, snapshotAgg, lastActivity] = await Promise.all([
          productModel.countDocuments({ ownerAdminId: adminId }),
          inventoryModel.countDocuments({ ownerAdminId: adminId }),
          (await snapshotModel.aggregate([
            { $match: { ownerAdminId: adminId } },
            {
              $group: {
                _id: null,
                totalRevenue: { $sum: "$totalRevenue" },
                totalProfit: { $sum: "$totalProfit" },
                totalSoldItems: { $sum: "$totalSoldItems" },
              },
            },
          ])) as any[],
          Promise.all([
            productModel.findOne({ ownerAdminId: adminId }).sort({ updatedAt: -1 }).select({ updatedAt: 1 }).lean().catch(() => null),
            inventoryModel.findOne({ ownerAdminId: adminId }).sort({ updatedAt: -1 }).select({ updatedAt: 1 }).lean().catch(() => null),
            snapshotModel.findOne({ ownerAdminId: adminId }).sort({ updatedAt: -1 }).select({ updatedAt: 1 }).lean().catch(() => null),
          ]).then((results) => {
            const dates = results
              .filter(Boolean)
              .map((r: any) => new Date(r.updatedAt).getTime());
            return dates.length > 0 ? new Date(Math.max(...dates)).toISOString() : null;
          }),
        ]);

        const topProducts = await snapshotModel.aggregate([
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
