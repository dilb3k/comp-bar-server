export type UserRole = "admin" | "staff";

export type AuditAction =
  | "USER_REGISTERED"
  | "PRODUCT_CREATED"
  | "PRODUCT_UPDATED"
  | "SALE_CREATED";
