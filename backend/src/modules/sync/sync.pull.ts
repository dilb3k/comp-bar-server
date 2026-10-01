import { createHmac, timingSafeEqual } from "node:crypto";
import { Types } from "mongoose";
import { z } from "zod";
import { env } from "../../config/env";
import { OwnerWriteVersion } from "../../lib/transaction";
import { AppError } from "../../utils/app-error";
import { getCurrentBusinessDate, getEffectiveHour } from "../../utils/business-day";
import type { AuthUser } from "../auth/auth.types";
import { ProductModel } from "../products/product.model";
import { ProductTombstoneModel } from "../products/product-tombstone.model";
import { InventoryEntryModel } from "../inventory/inventory.model";
import { DailySnapshotModel } from "../snapshots/snapshot.model";

const names = ["products", "inventory", "daily", "deletedProducts"] as const;
const models = [ProductModel, InventoryEntryModel, DailySnapshotModel, ProductTombstoneModel];
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const position = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/), revision: integer });
const tokenSchema = z.object({
  v: z.literal(2), owner: z.string(), scope: z.string(), high: integer,
  // A checkpoint has no page. A page always carries a fixed upper bound.
  page: z.object({ low: integer.nullable(), positions: z.array(position.nullable()).length(4), done: z.array(z.boolean()).length(4) }).optional(),
});
type Token = z.infer<typeof tokenSchema>;
function encode(token: Token) {
  const body = Buffer.from(JSON.stringify(token)).toString("base64url");
  return `${body}.${createHmac("sha256", env.JWT_SECRET).update(`sync-v2:${body}`).digest("base64url")}`;
}
function decode(value: string, owner: string): Token {
  try {
    if (value.length > 4096) throw Error();
    const parts = value.split(".");
    if (parts.length !== 2) throw Error();
    const expected = createHmac("sha256", env.JWT_SECRET).update(`sync-v2:${parts[0]}`).digest();
    const actual = Buffer.from(parts[1], "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw Error();
    const token = tokenSchema.parse(JSON.parse(Buffer.from(parts[0], "base64url").toString()));
    if (token.owner !== owner) throw Error();
    return token;
  } catch { throw new AppError("Invalid sync cursor; start a fresh pull", 400, undefined, "INVALID_SYNC_CURSOR"); }
}

/** Indexed, tenant-bound keyset pagination; no offset and no client clock. */
export async function pullChanges(actor: AuthUser, input: { cursor?: string; checkpoint?: string; limit?: number }) {
  const today = getCurrentBusinessDate(getEffectiveHour(actor), env.TIMEZONE_OFFSET);
  // Single-day history remains available through the normal explicit-date API.
  const scope = actor.tier === "tekin" ? `day:${today}` : "all";
  let token = input.cursor ? decode(input.cursor, actor.userId) : undefined;
  if (token && (!token.page || token.scope !== scope)) {
    throw new AppError("Sync scope changed; restart pull", 409, undefined, "SYNC_SCOPE_CHANGED");
  }
  if (!token) {
    const checkpoint = input.checkpoint ? decode(input.checkpoint, actor.userId) : undefined;
    if (checkpoint?.page) throw new AppError("Expected completed checkpoint", 400, undefined, "INVALID_SYNC_CURSOR");
    const fence: any = await OwnerWriteVersion.findById(actor.userId).read("primary").readConcern("majority").lean();
    const high = Number(fence?.revision ?? 0);
    const low = checkpoint?.scope === scope ? checkpoint.high : null;
    if (low !== null && low > high) throw new AppError("Server revision moved backwards; start a fresh pull", 409, undefined, "SYNC_RESET_REQUIRED");
    token = { v: 2, owner: actor.userId, scope, high, page: { low, positions: [null, null, null, null], done: [false, false, false, false] } };
  }
  const page = token.page!;
  const limit = Math.max(1, Math.min(input.limit ?? 200, 1000));
  const result: Record<(typeof names)[number], any[]> = { products: [], inventory: [], daily: [], deletedProducts: [] };
  await Promise.all(models.map(async (model, index) => {
    if (page.done[index]) return;
    const at = page.positions[index];
    const initial = page.low === null;
    const clauses: any[] = [{ ownerAdminId: actor.userId }];
    if (scope !== "all" && (index === 1 || index === 2)) clauses.push({ date: today });
    if (initial) {
      // Old documents have no version; they belong to the initial baseline.
      clauses.push({ $or: [{ serverVersion: { $lte: token.high } }, { serverVersion: { $exists: false } }] });
      if (at) clauses.push({ _id: { $gt: new Types.ObjectId(at.id) } });
    } else {
      clauses.push({ serverVersion: { $gt: page.low, $lte: token.high } });
      if (at) clauses.push({ $or: [
        { serverVersion: { $gt: at.revision } },
        { serverVersion: at.revision, _id: { $gt: new Types.ObjectId(at.id) } },
      ] });
    }
    const docs: any[] = await model.find({ $and: clauses }).sort(initial ? { _id: 1 } : { serverVersion: 1, _id: 1 })
      .limit(limit + 1).read("primary").readConcern("majority");
    page.done[index] = docs.length <= limit;
    const items = docs.slice(0, limit);
    const last = items.at(-1);
    if (last) page.positions[index] = { id: String(last._id), revision: Number(last.get("serverVersion") ?? 0) };
    result[names[index]] = items.map(doc => {
      const json = doc.toJSON();
      delete json.ownerAdminId;
      return { ...json, serverVersion: Number(doc.get("serverVersion") ?? 0) };
    });
  }));
  const hasMore = page.done.some(done => !done);
  return { ...result, protocolVersion: 2 as const, hasMore,
    nextCursor: hasMore ? encode(token) : null,
    checkpoint: hasMore ? null : encode({ v: 2, owner: actor.userId, scope, high: token.high }),
  };
}
