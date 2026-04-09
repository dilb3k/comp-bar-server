import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { HttpError } from "./http-error";
import { UserRole } from "../types/domain";

export type AuthPayload = {
  userId: string;
  workspaceId: string;
  role: UserRole;
};

export function signAccessToken(payload: AuthPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"]
  });
}

export function verifyAccessToken(token: string): AuthPayload {
  try {
    return jwt.verify(token, env.JWT_SECRET) as AuthPayload;
  } catch {
    throw new HttpError(401, "Invalid or expired token");
  }
}
