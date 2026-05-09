import type { Request } from "express";

const HASH_REGEX = /^[a-f0-9]{64}$/;

export function resolveImageUrl(req: Request, image?: string): string | undefined {
  if (!image) return undefined;
  if (image.startsWith("data:image/") || image.startsWith("https://") || image.startsWith("http://")) {
    return image;
  }
  if (HASH_REGEX.test(image)) {
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    return `${baseUrl}/api/products/image/${image}`;
  }
  return undefined;
}
