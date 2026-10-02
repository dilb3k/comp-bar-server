import { Schema, model, models } from "mongoose";
import bcrypt from "bcryptjs";

import { normalizePhone } from "./auth.utils";

const SALT_WORK_FACTOR = 10;

const userSchema = new Schema(
  {
    username: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    phone_number: {
      type: String,
      trim: true,
      default: "",
    },
    // Digits-only mirror of phone_number, kept in sync by the pre-save hook
    // below. findByPhone (bot /start linking, phone-verification login) used
    // to load every active admin into memory and scan them in JS to tolerate
    // phone_number's formatting differences (+998, spaces, dashes) — fine at
    // a handful of admins, a full-collection load on every lookup at real
    // scale. Indexed so that lookup is a direct query instead.
    phoneDigits: {
      type: String,
      default: "",
      index: true,
    },
    password: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      required: true,
      enum: ["admin", "superAdmin"],
      index: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    isPayed: {
      type: Boolean,
      default: false,
      index: true,
    },
    businessDayStartHour: {
      type: Number,
      default: 0,
    },
    pendingBusinessDayStartHour: {
      type: Number,
      default: null,
    },
    businessDayEffectiveFrom: {
      type: Date,
      default: null,
    },
    blockCode: {
      type: String,
      default: null,
    },
    securityVersion: { type: Number, default: 0 },
    activeSessionId: {
      type: String,
      default: null,
    },
    verifiedDeviceIds: {
      type: [String],
      default: [],
    },
    // Telegram account linked via the hisvex-bot payment/subscription bot
    // (matched by phone_number on /start, then remembered here so the bot
    // doesn't need to re-look-up on every interaction and so the backend
    // can DM expiry reminders directly).
    telegramId: {
      type: String,
      default: null,
      index: true,
    },
    telegramUsername: {
      type: String,
      default: null,
    },
    // Touched (throttled, see auth.middleware.ts) on every authenticated
    // request — the superAdmin-facing "is this admin actually using the app"
    // signal. Deliberately separate from `updatedAt`, which means "the
    // profile document was edited" and shouldn't be conflated with usage.
    lastActionAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform(_doc, ret: any) {
        ret.id = ret._id.toString();
        ret._id = ret.id;
        delete ret.password;
        // Trusted-device IDs are credentials for the session-conflict gate.
        // Exposing them to a procurement token would allow scope escalation.
        delete ret.verifiedDeviceIds;
        delete ret.activeSessionId;
        delete ret.securityVersion;
        return ret;
      },
    },
  },
);

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) {
    return next();
  }

  try {
    const salt = await bcrypt.genSalt(SALT_WORK_FACTOR);
    const hash = await bcrypt.hash(this.password, salt);
    this.password = hash;
    next();
  } catch (error: any) {
    next(error);
  }
});

userSchema.pre("save", function (next) {
  if (this.isModified("phone_number")) {
    this.phoneDigits = normalizePhone(this.phone_number);
  }
  next();
});

userSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.index({ username: 1 }, { unique: true });

userSchema.index({telegramId:1},{unique:true,partialFilterExpression:{telegramId:{$type:"string"}},name:"idx_unique_verified_telegram"});

export const UserModel = models.User ?? model("User", userSchema);
