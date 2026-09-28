import crypto from "crypto";

import { isR2Enabled, uploadImage } from "../../lib/r2";
import { buildImageKey, processImageToWebp } from "../../utils/image-processing";
import { productImageRepository } from "./product-image.repository";

const LOCAL_IMAGE_PROTOCOLS = ["file://", "content://", "ph://", "assets-library://", "blob:"];
const REMOTE_IMAGE_PROTOCOLS = ["http://", "https://", "data:image/"];

const ALLOWED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
];

const MAX_IMAGE_SIZE_BASE64 = 5 * 1024 * 1024;

function isValidImageMimeType(mimeType: string): boolean {
  return ALLOWED_IMAGE_MIME_TYPES.includes(mimeType.toLowerCase());
}

function hasProtocol(value: string, protocols: string[]) {
  const normalized = value.toLowerCase();
  return protocols.some((protocol) => normalized.startsWith(protocol));
}

export function normalizeProductImage(image?: string | null) {
  if (image === undefined || image === null) {
    return undefined;
  }

  const trimmed = image.trim();

  if (!trimmed) {
    return "";
  }

  if (hasProtocol(trimmed, LOCAL_IMAGE_PROTOCOLS)) {
    return undefined;
  }

  if (hasProtocol(trimmed, REMOTE_IMAGE_PROTOCOLS)) {
    return trimmed;
  }

  return trimmed;
}

const DATA_URL_REGEX = /^data:([^;]+);base64,(.+)$/;
const HASH_REGEX = /^[a-f0-9]{64}$/;
const IMAGE_ENDPOINT_HASH_REGEX = /\/api\/products\/image\/([a-f0-9]{64})(?:$|\?|#)/;

export interface ProcessedProductImageFields {
  // Set only for legacy values (an existing hash, or our own legacy
  // endpoint URL) — never for a freshly uploaded image, which always goes
  // to imageUrl now.
  image?: string;
  imageUrl?: string;
}

/**
 * Normalizes whatever a client sent in the legacy `image` field into
 * { image?, imageUrl? } for product.service.ts / sync.service.ts to spread
 * into their write payload. Replaces the old processAndStoreProductImage,
 * which stored every new photo as base64 in Mongo (product_images) — new
 * data:image/... payloads now go through sharp + R2 instead (see
 * utils/image-processing.ts, lib/r2.ts) and come back as an imageUrl.
 *
 * Falls back to the legacy Mongo store only when R2 isn't configured, which
 * is only possible outside production (config/env.ts hard-requires R2 vars
 * there) — so this fallback exists purely to keep local dev without R2 keys
 * working, not as a parallel storage path.
 */
export async function processProductImageInput(image?: string | null): Promise<ProcessedProductImageFields> {
  if (!image) return {};

  const trimmed = image.trim();
  if (!trimmed) return {};

  // Already a legacy hash — keep it in the legacy field, untouched.
  if (HASH_REGEX.test(trimmed)) {
    return { image: trimmed };
  }

  // URL to our own legacy image endpoint — extract hash and verify it exists.
  const endpointMatch = trimmed.match(IMAGE_ENDPOINT_HASH_REGEX);
  if (endpointMatch) {
    const hash = endpointMatch[1];
    const existing = await productImageRepository.findByHash(hash);
    return existing ? { image: hash } : { image: trimmed };
  }

  // Any other http(s) URL — an R2 URL the client already has (e.g. echoed
  // back on a sync round-trip) or an external URL — belongs in imageUrl now,
  // not the legacy field.
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return { imageUrl: trimmed };
  }

  // Only data:image/... payloads are actually processed.
  const match = trimmed.match(DATA_URL_REGEX);
  if (!match) {
    return {};
  }

  const mimeType = match[1];
  const base64Data = match[2];

  if (!isValidImageMimeType(mimeType)) {
    console.warn(`[ImageValidation] Rejected invalid image type: ${mimeType}`);
    return {};
  }

  if (base64Data.length > MAX_IMAGE_SIZE_BASE64) {
    console.warn(`[ImageValidation] Rejected oversized image: ${base64Data.length} bytes (max: ${MAX_IMAGE_SIZE_BASE64})`);
    return {};
  }

  if (isR2Enabled()) {
    try {
      const buffer = Buffer.from(base64Data, "base64");
      const processed = await processImageToWebp(buffer);
      const key = buildImageKey(processed.hash);
      const imageUrl = await uploadImage(processed.buffer, key, processed.contentType);
      return { imageUrl };
    } catch (error) {
      console.error("[ImageUpload] R2 upload failed, image not saved:", (error as Error).message);
      return {};
    }
  }

  // Dev-only fallback — see the function doc comment above.
  const hash = crypto.createHash("sha256").update(base64Data).digest("hex");
  await productImageRepository.upsertByHash(hash, base64Data, mimeType);
  return { image: hash };
}
