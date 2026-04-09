import { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../utils/jwt";
import { HttpError } from "../utils/http-error";
import { UserRole } from "../types/domain";

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    next(new HttpError(401, "Authorization header is missing"));
    return;
  }

  const token = authHeader.replace("Bearer ", "");
  req.auth = verifyAccessToken(token);
  next();
}

export function requireRole(roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new HttpError(401, "Unauthorized"));
      return;
    }

    if (!roles.includes(req.auth.role)) {
      next(new HttpError(403, "Forbidden"));
      return;
    }

    next();
  };
}
