import { z } from "zod";
import { normalizePhone } from "./auth.utils";

export const loginSchema = z.object({
  username: z.string().trim().min(1, "username is required"),
  password: z.string().min(1, "password is required"),
  deviceId: z.string().trim().min(1).max(128).optional(),
});

export const loginWithPhoneSchema = z.object({
  username: z.string().trim().min(1, "username is required"),
  password: z.string().min(1, "password is required"),
  phone_number: z.string().trim().min(4, "phone_number is required"),
  deviceId: z.string().trim().min(1).max(128).optional(),
});

export const verifySessionChallengeSchema = z.object({
  sessionChallengeId: z.string().trim().min(1, "sessionChallengeId is required"),
  otpCode: z.string().trim().regex(/^\d{6}$/, "otpCode must be 6 digits"),
  deviceId: z.string().trim().min(1).max(128).optional(),
});

export const registerSchema = z.object({
  phoneVerificationToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
  username: z.string().trim().min(3, "username must be at least 3 characters").max(64),
  password: z.string().min(6, "password must be at least 6 characters")
    .refine(value => Buffer.byteLength(value, "utf8") <= 72, "password must be at most 72 bytes"),
  phone_number: z.string().trim().regex(/^\+?[\d\s()-]+$/, "Telefon raqamingizni kiriting")
    .transform(normalizePhone).refine(value => value.length >= 7 && value.length <= 15, "Telefon raqamingizni to‘liq kiriting"),
  businessDayStartHour: z.number().int().min(0).max(23).optional(),
  deviceId: z.string().trim().min(1).max(128).optional(),
});

export const registrationStatusSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
export const registrationStartSchema = z.object({
  startToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  telegramId: z.string().regex(/^\d+$/),
});
export const registrationContactSchema = z.object({
  telegramId: z.string().regex(/^\d+$/),
  contactUserId: z.string().regex(/^\d+$/),
  phone: z.string().min(7).max(32),
  telegramUsername: z.string().max(64).optional(),
});

export const createAdminSchema = z.object({
  username: z.string().trim().min(3, "username must be at least 3 characters"),
  password: z.string().min(6, "password must be at least 6 characters"),
  // Required, not optional — this is the only value loginWithPhoneSchema's
  // check has anything to compare against. An admin created without one
  // silently disables the "another device is already signed in, confirm
  // your phone" protection for that whole account (phoneVerificationRequired
  // short-circuits to false with no phone_number on file), on every
  // platform, not just one.
  phone_number: z.string().trim().min(7, "phone_number is required"),
  tier: z.enum(["tekin", "bor", "pro"]).optional(),
  isPayed: z.boolean().optional(),
  durationMonths: z.coerce.number().int().min(1).max(12).optional(),
});

export const updateAdminSchema = z.object({
  username: z.string().trim().min(3, "username must be at least 3 characters").optional(),
  password: z.string().min(6, "password must be at least 6 characters").optional(),
  phone_number: z.string().trim().optional(),
  tier: z.enum(["tekin", "bor", "pro"]).optional(),
  isPayed: z.boolean().optional(),
  isActive: z.boolean().optional(),
  durationMonths: z.coerce.number().int().min(1).max(12).optional(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, "refreshToken is required"),
});

export const updateMeSchema = z.object({
  username: z.string().trim().min(3, "username must be at least 3 characters").optional(),
  phone_number: z.string().trim().optional(),
  businessDayStartHour: z.number().int().min(0).max(23).optional(),
  blockCode: z.string().regex(/^\d{4}$/).nullable().optional()
});
