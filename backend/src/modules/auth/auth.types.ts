export type UserRole = "admin" | "superAdmin";

export type AuthUser = {
  userId: string;
  username: string;
  role: UserRole;
  isPayed: boolean;
  businessDayStartHour?: number;
  pendingBusinessDayStartHour?: number | null;
  businessDayEffectiveFrom?: string | null;
};
