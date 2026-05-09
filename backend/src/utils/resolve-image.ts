import type { Request } from "express";

const HASH_REGEX = /^[a-f0-9]{64}$/;

function toPlain(value: unknown): unknown {
  if (value && typeof value === "object" && "toJSON" in (value as any) && typeof (value as any).toJSON === "function") {
    return (value as any).toJSON();
  }
  return value;
}

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
  const plain = toPlain(data) as T;

  if (Array.isArray(plain)) {
    return plain.map((item) => resolveProductImages(req, item)) as unknown as T;
  }
  if (!plain || typeof plain !== "object") return plain;

  const record = plain as Record<string, unknown>;

  if (typeof record.image === "string") {
    record.image = resolveImageUrl(req, record.image);
  }

  const product = record.product;
  if (product && typeof product === "object" && "image" in (product as any)) {
    const prod = product as Record<string, unknown>;
    if (typeof prod.image === "string") {
      prod.image = resolveImageUrl(req, prod.image);
    }
  }

  return record as T;
}
