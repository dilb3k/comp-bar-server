import { z } from "zod";

// A client (web/desktop) reports this right after its own failover logic
// switches between Railway and Render — the backend has no way to observe
// this on its own (whichever one is down can't alert on its own outage, and
// the one that's up has no idea a client just switched to/from it purely
// from normal request traffic).
export const reportFailoverSchema = z.object({
  event: z.enum(["failover", "recovered"]),
  from: z.string().trim().min(1).max(64),
  to: z.string().trim().min(1).max(64),
  reason: z.string().trim().max(200).optional(),
});
