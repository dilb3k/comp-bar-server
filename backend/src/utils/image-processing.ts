import crypto from "node:crypto";

import sharp from "sharp";

const MAX_BYTES = 200 * 1024;
const MAX_DIMENSION = 1200;
// Tried in order until the encoded WebP fits under MAX_BYTES. Starting at 80
// keeps product photos looking clean for the common case (small phone
// photos); the lower steps only matter for large/detailed originals.
const QUALITY_STEPS = [80, 60, 40] as const;

export interface ProcessedImage {
  buffer: Buffer;
  contentType: "image/webp";
  // sha256 of the ORIGINAL input bytes (not the re-encoded output), so the
  // same source photo always maps to the same key regardless of which
  // quality step ends up winning — that's what makes dedup work.
  hash: string;
}

async function encode(input: Buffer, quality: number): Promise<Buffer> {
  return sharp(input)
    .rotate() // apply EXIF orientation before resizing, then drop it
    .resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality })
    .toBuffer();
}

export async function processImageToWebp(input: Buffer): Promise<ProcessedImage> {
  const hash = crypto.createHash("sha256").update(input).digest("hex");

  let buffer = await encode(input, QUALITY_STEPS[0]);
  for (let i = 1; i < QUALITY_STEPS.length && buffer.length > MAX_BYTES; i++) {
    buffer = await encode(input, QUALITY_STEPS[i]);
  }

  return { buffer, contentType: "image/webp", hash };
}

export function buildImageKey(hash: string): string {
  return `products/${hash}.webp`;
}
