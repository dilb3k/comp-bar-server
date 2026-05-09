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

export function resolveProductImages<T>(req: Request, data: T): T {
  if (Array.isArray(data)) {
    return data.map((item) => resolveProductImages(req, item)) as T;
  }
  if (!data || typeof data !== "object") return data;

  const record = data as Record<string, unknown>;

  if (typeof record.image === "string") {
    record.image = resolveImageUrl(req, record.image);
  }

  for (const key of Object.keys(record)) {
    const value = record[key];
    if (Array.isArray(value) || (value && typeof value === "object")) {
      record[key] = resolveProductImages(req, value);
    }
  }

  return record as T;
}
