import crypto from "crypto";

export function createLocalId(prefix: string, seed?: string) {
  const random = crypto.randomBytes(8).toString("hex");
  const timestamp = Date.now().toString(36);
  return [prefix, seed, timestamp, random].filter(Boolean).join("_");
}
