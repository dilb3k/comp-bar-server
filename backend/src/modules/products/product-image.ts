import crypto from "crypto";
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

export async function processAndStoreProductImage(image?: string | null): Promise<string | undefined> {
  if (!image) return undefined;

  const trimmed = image.trim();
  if (!trimmed) return undefined;

  // Already a hash — keep it
  if (HASH_REGEX.test(trimmed)) {
    return trimmed;
  }

  // URL to our own image endpoint — extract hash and verify it exists
  const endpointMatch = trimmed.match(IMAGE_ENDPOINT_HASH_REGEX);
  if (endpointMatch) {
    const hash = endpointMatch[1];
    const existing = await productImageRepository.findByHash(hash);
    if (existing) return hash;
    return trimmed;
  }

  // Remote URL (http/https) that's not our endpoint — pass through
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  // Only process data:image/... URLs
   const match = trimmed.match(DATA_URL_REGEX);
   if (!match) {
     return undefined;
   }

   const mimeType = match[1];
   const base64Data = match[2];

   if (!isValidImageMimeType(mimeType)) {
     console.warn(`[ImageValidation] Rejected invalid image type: ${mimeType}`);
     return undefined;
   }

   if (base64Data.length > MAX_IMAGE_SIZE_BASE64) {
     console.warn(`[ImageValidation] Rejected oversized image: ${base64Data.length} bytes (max: ${MAX_IMAGE_SIZE_BASE64})`);
     return undefined;
   }

   const hash = crypto.createHash("sha256").update(base64Data).digest("hex");
   await productImageRepository.upsertByHash(hash, base64Data, mimeType);
   return hash;
}
