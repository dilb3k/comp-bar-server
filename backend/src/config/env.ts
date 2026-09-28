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
  // Defaults closed. Self-serve signup is a real feature some deployments
  // want, but it must be an explicit choice, not something a fresh prod
  // deploy inherits silently. See the hard production check below.
  ALLOW_PUBLIC_REGISTER: z.coerce.boolean().default(false),

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

// ALLOW_PUBLIC_REGISTER now defaults to false and is force-checked the same
// way JWT_REFRESH_SECRET is: open self-registration in production is refused
// outright rather than merely warned about, because every admin account
// beyond the bootstrap superAdmin is meant to be created deliberately via
// POST /api/auth/admins (superAdmin-only), not discovered by a stranger
// hitting /register. An operator who genuinely wants public signup in
// production is asking this codebase to do something it now considers
// misconfiguration, not a supported mode.
if (parsed.data.NODE_ENV === "production" && parsed.data.ALLOW_PUBLIC_REGISTER) {
  console.error(
    "ALLOW_PUBLIC_REGISTER=true is not allowed in production. Admin accounts are created via " +
      "POST /api/auth/admins (superAdmin-only); leave this unset/false and remove it from the environment."
  );
  process.exit(1);
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
