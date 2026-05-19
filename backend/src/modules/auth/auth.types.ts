export type UserRole = "admin" | "superAdmin";

export type SubscriptionTier = "tekin" | "bor" | "pro";

export type AuthUser = {
  userId: string;
  username: string;
  role: UserRole;
  isPayed: boolean;
  tier: SubscriptionTier;
  subscriptionEndDate?: string | null;
  businessDayStartHour?: number;
  pendingBusinessDayStartHour?: number | null;
  businessDayEffectiveFrom?: string | null;
};
