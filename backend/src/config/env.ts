import dotenv from "dotenv";
import { z } from "zod";

if (process.env.NODE_ENV !== "test") dotenv.config();

const envBoolean = z.preprocess((value) => {
  if (typeof value === "string") {
    if (value.trim().toLowerCase() === "true") return true;
    if (value.trim().toLowerCase() === "false") return false;
  }
  return value;
}, z.boolean().default(false));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  WEB_CONCURRENCY: z.string().regex(/^(auto|[1-9][0-9]?)$/).default("auto"),
  DEPLOYMENT_REPLICAS: z.coerce.number().int().min(1).max(100).default(2),
  MONGO_MAX_POOL_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
  MONGO_MIN_POOL_SIZE: z.coerce.number().int().min(0).max(100).default(10),
  MONGO_CONNECTION_BUDGET: z.coerce.number().int().min(20).default(660),
  MONGO_CONNECTION_RESERVE: z.coerce.number().int().min(0).default(24),
  MONGO_TOPOLOGY_MEMBERS: z.coerce.number().int().min(1).max(50).default(3),
  API_READ_LIMIT: z.coerce.number().int().positive().default(3000),
  HTTP_LOG_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.01),
  API_WRITE_LIMIT: z.coerce.number().int().positive().default(600),
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
  // Token of the interactive hisvex-bot that owns users' linked chats.
  // BOT_TOKEN may belong to a separate reporting bot; retain it as a fallback
  // for deployments where the same bot handles both reports and login OTPs.
  OTP_TELEGRAM_BOT_TOKEN: z.preprocess(
    value => typeof value === "string" && !value.trim() ? undefined : value,
    z.string().trim().min(1).optional(),
  ),
  TELEGRAM_CHAT_ID: z.string().trim().min(1).optional(),
  // Separate from TELEGRAM_CHAT_ID above (business events: new product, sale,
  // sync) — this is the ops channel for infrastructure alerts (failover, DB
  // errors, 5xx crashes). Same BOT_TOKEN, different chat, so ops noise never
  // buries a business-event report or vice versa. Falls back to
  // TELEGRAM_CHAT_ID when unset so a deploy that hasn't configured a separate
  // ops chat yet still gets alerted somewhere rather than silently nowhere.
  ALERT_TELEGRAM_CHAT_ID: z.string().trim().min(1).optional(),
  MIGRATION_ENABLED: envBoolean,
  // Operators opt into tenant signup. Public signup never creates superAdmins.
  ALLOW_PUBLIC_REGISTER: envBoolean,

  // Shared secret the hisvex-bot service presents (X-Bot-Secret header) to
  // call the internal /api/bot/* routes. Optional here so the backend can
  // still boot without the bot deployed yet; botAuth middleware fails
  // closed (401/503) when this is unset, so leaving it empty just means
  // the bot integration is off, not an open door.
  BOT_INTERNAL_SECRET: z.string().trim().min(16).optional(),

  // Click (click.uz) merchant credentials for automatic subscription
  // payments. All optional — clickPaymentService.isEnabled() gates the
  // webhook the same way telegramReportService gates its own calls, so an
  // unconfigured Click integration fails closed (rejects, doesn't crash).
  CLICK_MERCHANT_ID: z.string().trim().optional(),
  CLICK_SERVICE_ID: z.string().trim().optional(),
  CLICK_SECRET_KEY: z.string().trim().optional(),

  // Fallback for /meta/app-version, which the mobile UpdateAvailableModal
  // polls. It normally reads dilb3k/hisvex-mobile's releases at request time
  // (see modules/meta/latest-release.ts) — these two only answer when GitHub
  // is unreachable or rate-limiting us.
  //
  // They used to BE the source of truth, hand-synced across three places, and
  // predictably went stale: they still said 1.0.3 while 1.1.0 was published.
  // Keep them pointing at a real, installable release so the fallback is
  // never worse than silence, but publishing the GitHub release is what
  // actually ships an update now.
  MOBILE_LATEST_VERSION: z.string().trim().default("1.1.0"),
  MOBILE_DOWNLOAD_URL: z.string().trim().default(
    "https://github.com/dilb3k/hisvex-mobile/releases/latest"
  ),

  // Cloudflare R2 (S3-compatible) product image storage. All five optional
  // here, mirroring the Click integration: isR2Enabled() gates every upload
  // path, so a dev environment without R2 keys falls back to the legacy
  // Mongo-stored image (see modules/products/product-image.ts) instead of
  // crashing. Production has no such fallback — the hard check below
  // refuses to boot without all five, the same way it refuses to boot
  // without JWT_REFRESH_SECRET.
  R2_ACCOUNT_ID: z.string().trim().optional(),
  R2_ACCESS_KEY_ID: z.string().trim().optional(),
  R2_SECRET_ACCESS_KEY: z.string().trim().optional(),
  R2_BUCKET_NAME: z.string().trim().optional(),
  // Public base URL product image links are built from (either R2's own
  // public bucket URL or a custom domain in front of it) — no trailing
  // slash required, lib/r2.ts strips one if present.
  R2_PUBLIC_URL: z.string().trim().optional(),
});

const parsed = envSchema.refine(value => value.MONGO_MIN_POOL_SIZE <= value.MONGO_MAX_POOL_SIZE
  && value.MONGO_CONNECTION_RESERVE < value.MONGO_CONNECTION_BUDGET, "Invalid MongoDB pool budget").safeParse(process.env);

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

// Outside production/test, JWT_REFRESH_SECRET is still derived from
// JWT_SECRET below for convenience (so `npm run dev` and other ad-hoc local
// setups don't need an extra env var). `npm test` sets JWT_SECRET inline and
// relies on this same fallback, so we deliberately don't warn for "test".
// This is not a secret-strength issue in dev, just a loud reminder so nobody
// carries this shortcut into a real deployment by mistake.
if (parsed.data.NODE_ENV === "development" && !parsed.data.JWT_REFRESH_SECRET) {
  console.warn(
    "JWT_REFRESH_SECRET is not set — deriving it from JWT_SECRET with a fixed suffix for local development only. " +
      "Set JWT_REFRESH_SECRET explicitly before deploying to production (production already refuses to boot without it)."
  );
}

const R2_VARS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_PUBLIC_URL",
] as const;

if (parsed.data.NODE_ENV === "production") {
  const missing = R2_VARS.filter((key) => !parsed.data[key]);
  if (missing.length > 0) {
    console.error(
      `Missing required R2 configuration in production: ${missing.join(", ")}. ` +
        "Product image uploads have no base64/Mongo fallback in production — configure R2 or the server won't boot."
    );
    process.exit(1);
  }
}

export const env = {
  ...parsed.data,
  JWT_REFRESH_SECRET: parsed.data.JWT_REFRESH_SECRET || (parsed.data.JWT_SECRET + "_refresh_salt_2024"),
};
