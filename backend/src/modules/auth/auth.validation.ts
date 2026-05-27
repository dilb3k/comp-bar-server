import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().trim().min(1, "username is required"),
  password: z.string().min(1, "password is required")
});

export const registerSchema = z.object({
  username: z.string().trim().min(3, "username must be at least 3 characters"),
  password: z.string().min(6, "password must be at least 6 characters")
});

export const createAdminSchema = z.object({
  username: z.string().trim().min(3, "username must be at least 3 characters"),
  password: z.string().min(6, "password must be at least 6 characters"),
  tier: z.enum(["tekin", "bor", "pro"]).optional(),
  isPayed: z.boolean().optional()
});

export const updateAdminSchema = z.object({
  username: z.string().trim().min(3, "username must be at least 3 characters").optional(),
  password: z.string().min(6, "password must be at least 6 characters").optional(),
  tier: z.enum(["tekin", "bor", "pro"]).optional(),
  isPayed: z.boolean().optional()
});

export const updateMeSchema = z.object({
  businessDayStartHour: z.number().int().min(0).max(23).optional(),
  blockCode: z.string().regex(/^\d{4}$/).nullable().optional()
});
