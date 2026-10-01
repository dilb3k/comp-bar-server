import { randomUUID } from "node:crypto";
import { currentSession } from "../../lib/transaction";
import { Types } from "mongoose";

import { UserModel } from "./user.model";
import { normalizePhone } from "./auth.utils";

export class AuthRepository {
  async findByUsername(username: string) {
    return UserModel.findOne({ username: username.trim().toLowerCase() });
  }

  // Used by the bot to link a Telegram user to their Hisvex account after
  // they share their contact via /start. Matches on the digits-only form of
  // phone_number so formatting differences (+998, spaces, dashes) don't
  // cause a false miss — mirrors normalizePhone's use elsewhere for the
  // same reason (phoneVerificationRequired).
  async findByPhone(phone: string) {
    const digits = normalizePhone(phone);
    if (digits.length < 6) return null;
    // Direct indexed lookup on phoneDigits (kept in sync by user.model.ts's
    // pre-save hook) — used to load every active admin into memory and scan
    // them in JS for this, a full-collection load on every bot /start link
    // or phone-verification login at real admin-count scale.
    const matches=await UserModel.find({role:"admin",isActive:true,phoneDigits:digits}).limit(2);
    return matches.length===1?matches[0]:null;
  }

  async findByTelegramId(telegramId: string) {
    return UserModel.findOne({ telegramId, isActive: true });
  }

  async linkTelegram(id: string, telegramId: string, telegramUsername?: string, verifiedPhone?: string) {
    if (!Types.ObjectId.isValid(id)) return null;
    if (!verifiedPhone) return null;
    return UserModel.findOneAndUpdate(
      { _id:id, isActive:true, role:"admin", phoneDigits:normalizePhone(verifiedPhone), $or:[{telegramId:null},{telegramId}] },
      { telegramId, telegramUsername: telegramUsername ?? null },
      { new: true }
    );
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

    return UserModel.findById(id).session(currentSession() ?? null);
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

    const user = await UserModel.findById(id).session(currentSession() ?? null);
    if (!user) return null;

    if (payload.username !== undefined) (user as any).username = payload.username.trim().toLowerCase();
    if (payload.phone_number !== undefined) user.phone_number = payload.phone_number.trim();
    if (payload.password !== undefined || payload.isActive === false) {
      user.activeSessionId = randomUUID();
      user.securityVersion = Number(user.securityVersion ?? 0) + 1;
      user.verifiedDeviceIds = [];
    }
    if (payload.password !== undefined) user.password = payload.password;
    if (payload.isPayed !== undefined) user.isPayed = payload.isPayed;
    if (payload.isActive !== undefined) (user as any).isActive = payload.isActive;
    if (payload.businessDayStartHour !== undefined) (user as any).businessDayStartHour = payload.businessDayStartHour;

    return user.save({session: currentSession()});
  }

  async updateMe(
    id: string,
    payload: { username?: string; phone_number?: string; businessDayStartHour?: number; pendingBusinessDayStartHour?: number | null; businessDayEffectiveFrom?: Date | null; blockCode?: string | null; activeSessionId?: string | null },
  ) {
    if (!Types.ObjectId.isValid(id)) return null;

    const user = await UserModel.findById(id).session(currentSession() ?? null);
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

    return user.save({session: currentSession()});
  }

  /**
   * Promotes a scheduled business-day hour change into the active field once
   * its effective moment has passed, then clears the pending fields.
   *
   * Conditional on the pending pair still matching what the caller read, so
   * the concurrent requests that all run this check (it sits in the auth
   * middleware) can't double-apply it or clobber a newer schedule — the first
   * one wins and the rest no-op, returning null.
   */
  async promoteBusinessDayHourIfDue(id: string, pendingHour: number, effectiveFrom: Date) {
    if (!Types.ObjectId.isValid(id)) return null;
    return UserModel.findOneAndUpdate(
      {
        _id: id,
        pendingBusinessDayStartHour: pendingHour,
        businessDayEffectiveFrom: effectiveFrom,
      },
      {
        $set: {
          businessDayStartHour: pendingHour,
          pendingBusinessDayStartHour: null,
          businessDayEffectiveFrom: null,
        },
      },
      { new: true },
    );
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

  /**
   * Fire-and-forget "last seen" touch — called from the auth middleware on
   * every authenticated request, throttled by the caller so this doesn't
   * write on literally every single one. `timestamps: false` so this
   * intentionally does NOT also bump `updatedAt` (that field means "profile
   * was edited", this one means "user was active").
   */
  async touchLastActionAt(id: string) {
    if (!Types.ObjectId.isValid(id)) return;
    await UserModel.updateOne(
      { _id: id, $or: [{ lastActionAt: { $lt: new Date(Date.now()-5*60*1000) } }, { lastActionAt: null }] },
      { $set: { lastActionAt: new Date() } },
      { timestamps: false },
    );
  }
}

export const authRepository = new AuthRepository();
