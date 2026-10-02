export type UserRole = "admin" | "superAdmin";

export type SubscriptionTier = "tekin" | "bor" | "pro";

export type AuthUser = {
  userId: string;
  securityVersion?: number;
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
  // Present only on a procurement-agent token (see
  // auth.service.ts#issueProcurementScopeToken). Absent on every normal
  // token — undefined always means "full access", so this is purely
  // additive and every token issued before this feature existed keeps
  // working unchanged. `role` above still reflects the REAL account role;
  // this is a separate, narrower capability layer on top of it, checked by
  // auth.middleware.ts's allowlist gate, not by authorize(...roles).
  scope?: "procurement";
};
