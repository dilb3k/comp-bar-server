import { z } from "zod";

export const registerSchema = z.object({
  workspaceId: z.string().uuid().optional(),
  name: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(6).max(128),
  role: z.literal("staff").optional().default("staff")
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(128)
});
