import { Schema, model, models } from "mongoose";

export type SubscriptionTier = "tekin" | "bor" | "pro";

export interface ISubscription {
  userId: string;
  tier: "bor" | "pro";
  startDate: Date;
  endDate: Date;
  isActive: boolean;
  activatedBy: string;
  // Set once the bot successfully DMs the user an expiry reminder for THIS
  // subscription period. Renewal always deactivates the old doc and creates
  // a fresh one (see activateFromPayment), so this naturally resets to null
  // every period — no separate cleanup needed. Without it, findExpiringSoon
  // matched the same subscription on every daily cron run until it actually
  // expired, so a user got the same reminder up to REMINDER_DAYS_BEFORE times.
  reminderSentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const subscriptionSchema = new Schema<ISubscription>(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    tier: {
      type: String,
      required: true,
      enum: ["bor", "pro"],
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    activatedBy: {
      type: String,
      required: true,
    },
    reminderSentAt: {
      type: Date,
      default: null,
    },
  },
  {
    collection: "subscriptions",
    timestamps: true,
    versionKey: false,
  }
);

subscriptionSchema.index({ userId: 1, isActive: 1 });
subscriptionSchema.index({ endDate: 1, isActive: 1 });

// The real backstop against two active subscriptions for one user: the
// application-level "find existing, extend or create" flow in
// subscription.service.ts already avoids this in the common case, but two
// payments completing within the same read-write window (a Click webhook and
// an OCR auto-provision, say) could otherwise both pass their own "no active
// subscription yet" check before either commits. A partial unique index
// enforces it at the database level regardless of how many app instances or
// concurrent requests are racing — MongoDB itself rejects the second insert.
subscriptionSchema.index(
  { userId: 1 },
  { unique: true, partialFilterExpression: { isActive: true }, name: "idx_one_active_subscription_per_user" },
);

export const SubscriptionModel =
  models.Subscription ?? model<ISubscription>("Subscription", subscriptionSchema);

export function computeTier(
  role: string,
  isPayed: boolean,
  activeSubscription: ISubscription | null
): SubscriptionTier {
  if (role === "superAdmin") return "pro";
  if (activeSubscription && activeSubscription.isActive && new Date(activeSubscription.endDate) > new Date()) {
    return activeSubscription.tier === "pro" ? "pro" : "bor";
  }
  // The historical boolean is a projection, never a timeless paid grant.
  return "tekin";
}
