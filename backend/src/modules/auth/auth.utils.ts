import jwt, { type SignOptions } from "jsonwebtoken";
import crypto from "crypto";

import { env } from "../../config/env";
import type { AuthUser } from "./auth.types";

export function signAccessToken(payload: AuthUser) {
  const options: SignOptions = {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"]
  };

  return jwt.sign(payload, env.JWT_SECRET, options);
}

export function verifyAccessToken(token: string) {
  return jwt.verify(token, env.JWT_SECRET) as AuthUser & {
    iat: number;
    exp: number;
  };
}

export function signRefreshToken(payload: { userId: string; sessionId?: string }) {
  const options: SignOptions = {
    expiresIn: env.REFRESH_TOKEN_EXPIRES_IN as SignOptions["expiresIn"]
  };

  return jwt.sign(payload, env.JWT_REFRESH_SECRET, options);
}

export function verifyRefreshToken(token: string) {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as {
    userId: string;
    sessionId?: string;
    iat: number;
    exp: number;
  };
}

export function createSessionId(): string {
  return crypto.randomUUID();
}

export function normalizePhone(value: string | undefined | null): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function maskPhone(value: string | undefined | null): string {
  const digits = normalizePhone(value);
  if (digits.length < 6) {
    return "+998 ••• ••• •• ••";
  }
  const head = digits.slice(0, 4);
  const tail = digits.slice(-2);
  const middle = digits.slice(4, -2).replace(/./g, "•");
  return `+${head} ${middle} ${tail}`;
}

export interface PhoneVerificationContext {
  activeSessionId?: string | null;
  phone_number?: string;
  verifiedDeviceIds?: string[];
}

export function phoneVerificationRequired(user: PhoneVerificationContext, deviceId?: string | null): boolean {
  if (!user.activeSessionId || !user.phone_number || normalizePhone(user.phone_number).length < 6) {
    return false;
  }
  if (deviceId && (user.verifiedDeviceIds ?? []).includes(deviceId)) {
    return false;
  }
  return true;
}

export function shouldClearActiveSession(user: { activeSessionId?: string | null }, sessionId?: string | null): boolean {
  if (!sessionId) return false;
  return user.activeSessionId === sessionId;
}
