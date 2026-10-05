import type { Request, Response } from "express";
import { OwnerWriteVersion } from "./transaction";
import { readCache } from "./read-cache";
import { getCurrentBusinessDate, getEffectiveHour } from "../utils/business-day";
import { env } from "../config/env";

export async function cachedOwnerRead(req: Request, res: Response, route: string, load: () => Promise<unknown>) {
  const actor = req.auth!;
  // Never cache identity/session/entitlement checks. This runs AFTER auth.
  // Committed owner writes bump revision in the same transaction, making
  // cache invalidation immediate across API workers and deployment replicas.
  const fence: any = await OwnerWriteVersion.findById(actor.userId).select("revision").read("primary").readConcern("majority").lean();
  const key = JSON.stringify([actor.userId, fence?.revision ?? 0, actor.scope, actor.tier,
    getCurrentBusinessDate(getEffectiveHour(actor), env.TIMEZONE_OFFSET), route,
    Object.entries(req.query).sort(([a], [b]) => a.localeCompare(b))]);
  const body = await readCache.get(key, async () => JSON.stringify({ success: true, data: await load() }));
  res.setHeader("Cache-Control", "private, no-store");
  return res.type("json").send(body);
}
