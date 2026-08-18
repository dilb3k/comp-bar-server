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
  ALLOW_PUBLIC_REGISTER: z.coerce.boolean().default(true),

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

  // Mobile has no store/GitHub-releases feed to check against (it ships as
  // a direct EAS build link, not a Play Store listing), so — unlike the
  // desktop app, which reads dilb3k/hisvex-landing's GitHub releases
  // directly — its "is a new version out" check goes through this backend
  // instead. Bump these two on every mobile release; no redeploy needed,
  // just an env var update on the host.
  //
  // These defaults are hand-synced with two OTHER places — a mobile release
  // isn't done until all three agree, or media-project-mobile's
  // UpdateAvailableModal.tsx will fire against a stale/wrong target:
  //   1. media-project-mobile/app.json + package.json "version"
  //   2. hisvex-landing/src/App.tsx's MOBILE_APK_VERSION / MOBILE_APK_URL
  //   3. right here (and the actual env vars on the backend host — these
  //      defaults only apply when the host doesn't override them)
  MOBILE_LATEST_VERSION: z.string().trim().default("1.0.1"),
  MOBILE_DOWNLOAD_URL: z.string().trim().default(
    "https://expo.dev/accounts/hisvex/projects/hisvex/builds/e9188422-b986-4702-bd6b-5ea5eeea36d0"
  ),
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

// ALLOW_PUBLIC_REGISTER defaults to true (self-serve signup may be
// intentional); it is not force-checked like JWT_REFRESH_SECRET. Still, an
// operator deploying to production should consciously decide this rather
// than inherit the default silently — warn (don't block boot) when it was
// left unset in production. Check the raw env var (not the coerced/defaulted
// value) so an explicit `ALLOW_PUBLIC_REGISTER=true` doesn't warn.
if (parsed.data.NODE_ENV === "production" && process.env.ALLOW_PUBLIC_REGISTER === undefined) {
  console.warn(
    "ALLOW_PUBLIC_REGISTER is not set in production — defaulting to true (public self-registration is open). " +
      "Set ALLOW_PUBLIC_REGISTER=false explicitly if that's not intended."
  );
}

export const env = {
  ...parsed.data,
  JWT_REFRESH_SECRET: parsed.data.JWT_REFRESH_SECRET || (parsed.data.JWT_SECRET + "_refresh_salt_2024"),
};
