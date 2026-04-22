import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().trim().min(1, "username is required"),
  password: z.string().min(1, "password is required")
});

export const createAdminSchema = z.object({
  username: z.string().trim().min(3, "username must be at least 3 characters"),
  password: z.string().min(6, "password must be at least 6 characters")
});
