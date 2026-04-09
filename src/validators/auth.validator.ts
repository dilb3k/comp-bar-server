import { z } from "zod";

export const registerSchema = z
  .object({
    workspaceName: z.string().min(2).max(120).optional(),
    workspaceId: z.string().uuid().optional(),
    name: z.string().min(2).max(120),
    email: z.string().email(),
    password: z.string().min(6).max(128),
    role: z.enum(["admin", "staff"]).optional()
  })
  .refine((value) => Boolean(value.workspaceName || value.workspaceId), {
    message: "Either workspaceName or workspaceId is required",
    path: ["workspaceName"]
  });

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(128)
});
