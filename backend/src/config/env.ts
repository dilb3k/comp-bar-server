import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URL: z.string().min(1, "MONGODB_URL is required"),
  CLIENT_URL: z.string().default("*"),
  BUSINESS_DAY_START_HOUR: z.coerce.number().int().min(0).max(23).default(7),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  BOT_TOKEN: z.string().trim().min(1).optional(),
  TELEGRAM_CHAT_ID: z.string().trim().min(1).optional()
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
