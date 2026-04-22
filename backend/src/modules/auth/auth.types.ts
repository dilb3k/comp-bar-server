export type UserRole = "admin" | "superAdmin";

export type AuthUser = {
  userId: string;
  username: string;
  role: UserRole;
};
