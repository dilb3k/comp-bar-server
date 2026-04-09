import { UserRole } from "./domain";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        workspaceId: string;
        role: UserRole;
      };
    }
  }
}

export {};
