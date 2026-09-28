import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { env } from "../config/env";
import { AppError } from "../utils/app-error";

// R2 is S3-compatible, so the AWS SDK talks to it directly — only the
// endpoint differs (Cloudflare's account-scoped URL instead of AWS's).
// `region: "auto"` is what Cloudflare's own docs specify; R2 doesn't have
// regions the way S3 does, but the SDK requires the field to be present.
const r2Client =
  env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY
    ? new S3Client({
        region: "auto",
        endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: env.R2_ACCESS_KEY_ID,
          secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        },
      })
    : null;

// Mirrors clickPaymentService.isEnabled() — callers check this instead of
// assuming R2 is always configured, so a dev environment without R2 keys
// degrades (falls back to the legacy Mongo image store) instead of crashing.
// Production can't reach that fallback: config/env.ts refuses to boot there
// unless all five R2_* vars are set.
export function isR2Enabled(): boolean {
  return r2Client !== null && Boolean(env.R2_BUCKET_NAME) && Boolean(env.R2_PUBLIC_URL);
}

export async function uploadImage(buffer: Buffer, key: string, contentType: string): Promise<string> {
  if (!r2Client || !env.R2_BUCKET_NAME || !env.R2_PUBLIC_URL) {
    throw new AppError("Image storage is not configured", 503);
  }

  await r2Client.send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      // Keys are content-addressed (sha256 of the image), so the same key
      // never means different bytes — safe to cache forever.
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );

  return `${env.R2_PUBLIC_URL.replace(/\/+$/, "")}/${key}`;
}

export async function deleteImage(key: string): Promise<void> {
  if (!r2Client || !env.R2_BUCKET_NAME) return;

  try {
    await r2Client.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }));
  } catch (error) {
    // Never let a stale-object cleanup failure fail the request that
    // triggered it (a product update/delete) — log and move on, same
    // fire-and-forget tolerance the codebase already gives
    // telegramReportService calls.
    console.warn(`[r2] Could not delete object "${key}":`, (error as Error).message);
  }
}

// Recovers the object key from a URL previously returned by uploadImage, so
// a product update/delete can clean up the object it's replacing. Returns
// null for anything that isn't one of our own R2 URLs (an external image URL
// a client passed through, for instance) — those are never ours to delete.
export function keyFromPublicUrl(url: string): string | null {
  if (!env.R2_PUBLIC_URL) return null;
  const base = env.R2_PUBLIC_URL.replace(/\/+$/, "");
  if (!url.startsWith(base)) return null;
  return url.slice(base.length).replace(/^\/+/, "") || null;
}
