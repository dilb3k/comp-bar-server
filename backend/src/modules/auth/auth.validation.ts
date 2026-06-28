import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().trim().min(1, "username is required"),
  password: z.string().min(1, "password is required")
});

export const registerSchema = z.object({
  username: z.string().trim().min(3, "username must be at least 3 characters"),
  password: z.string().min(6, "password must be at least 6 characters"),
  phone_number: z.string().trim().optional(),
  businessDayStartHour: z.number().int().min(0).max(23).optional(),
});

export const createAdminSchema = z.object({
  username: z.string().trim().min(3, "username must be at least 3 characters"),
  password: z.string().min(6, "password must be at least 6 characters"),
  phone_number: z.string().trim().optional(),
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
