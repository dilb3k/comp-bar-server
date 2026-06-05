import { Schema, model, models } from "mongoose";

export type SubscriptionTier = "tekin" | "bor" | "pro";

export interface ISubscription {
  userId: string;
  tier: "bor" | "pro";
  startDate: Date;
  endDate: Date;
  isActive: boolean;
  activatedBy: string;
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
  },
  {
    collection: "subscriptions",
    timestamps: true,
    versionKey: false,
  }
);

subscriptionSchema.index({ userId: 1, isActive: 1 });
subscriptionSchema.index({ endDate: 1, isActive: 1 });

export const SubscriptionModel =
  models.Subscription ?? model<ISubscription>("Subscription", subscriptionSchema);

export function computeTier(
  role: string,
  isPayed: boolean,
  activeSubscription: ISubscription | null
): SubscriptionTier {
  if (activeSubscription) {
    return activeSubscription.tier === "pro" ? "pro" : "bor";
  }
  return isPayed ? "bor" : "tekin";
}
