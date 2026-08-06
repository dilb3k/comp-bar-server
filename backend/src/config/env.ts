import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URL: z.string().min(1, "MONGODB_URL is required"),
  MONGODB_FALLBACK_URL: z.string().optional(),
  CLIENT_URL: z.string().default("*"),
  BUSINESS_DAY_START_HOUR: z.coerce.number().int().min(0).max(23).default(6),
  TIMEZONE_OFFSET: z.coerce.number().int().default(300),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  JWT_REFRESH_SECRET: z.string().optional(),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default("30d"),
  BOT_TOKEN: z.string().trim().min(1).optional(),
  TELEGRAM_CHAT_ID: z.string().trim().min(1).optional(),
  MIGRATION_ENABLED: z.coerce.boolean().default(false),
  ALLOW_PUBLIC_REGISTER: z.coerce.boolean().default(true)
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables");
  process.exit(1);
}

if (parsed.data.NODE_ENV === "production" && !parsed.data.JWT_REFRESH_SECRET) {
  console.error(
    "JWT_REFRESH_SECRET is required in production. Refusing to boot with a secret derived from JWT_SECRET."
  );
  process.exit(1);
}

export const env = {
  ...parsed.data,
  JWT_REFRESH_SECRET: parsed.data.JWT_REFRESH_SECRET || (parsed.data.JWT_SECRET + "_refresh_salt_2024"),
};
