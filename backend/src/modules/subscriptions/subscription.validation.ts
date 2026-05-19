import { z } from "zod";

export const activateSubscriptionSchema = z.object({
  userId: z.string().min(1),
  tier: z.enum(["bor", "pro"]),
});
