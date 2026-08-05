export type UserRole = "admin" | "superAdmin";

export type SubscriptionTier = "tekin" | "bor" | "pro";

export type AuthUser = {
  userId: string;
  username: string;
  phone_number?: string;
  role: UserRole;
  isPayed: boolean;
  tier: SubscriptionTier;
  subscriptionEndDate?: string | null;
  businessDayStartHour?: number;
  pendingBusinessDayStartHour?: number | null;
  businessDayEffectiveFrom?: string | null;
  blockCode?: string | null;
  sessionId?: string;
};
