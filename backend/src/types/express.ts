import type { UserRole } from "../modules/auth/auth.types";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        username: string;
        role: UserRole;
      };
    }
  }
}

export {};
