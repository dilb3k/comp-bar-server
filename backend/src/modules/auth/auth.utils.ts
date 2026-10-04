import jwt, { type SignOptions } from "jsonwebtoken";
import crypto from "crypto";

import { env } from "../../config/env";
import type { AuthUser } from "./auth.types";

export function signAccessToken(payload: AuthUser, expiresInOverride?: string) {
  const options: SignOptions = {
    expiresIn: (expiresInOverride ?? env.JWT_EXPIRES_IN) as SignOptions["expiresIn"]
  };

  const {blockCode: _localPin, ...claims}=payload;
  return jwt.sign(claims, env.JWT_SECRET, options);
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
  activeSessionLastSeenAt?: Date | string | null;
  activeSessionExpiresAt?: Date | string | null;
  lastActionAt?: Date | string | null;
  phone_number?: string;
  verifiedDeviceIds?: string[];
}

export const SESSION_ACTIVITY_TTL_MS = 5 * 60 * 1000;
export const SESSION_ACTIVITY_TOUCH_MS = 30 * 1000;

export function phoneVerificationRequired(user: PhoneVerificationContext, _deviceId?: string | null, now = Date.now()): boolean {
  // A device ID is client supplied; it must not waive a real session takeover.
  if (!user.activeSessionId) return false;
  if (user.activeSessionExpiresAt != null) {
    const expires = new Date(user.activeSessionExpiresAt).getTime();
    if (!Number.isFinite(expires) || expires <= now) return false;
  }
  // General account activity (including procurement) cannot prove that the
  // normal session is alive. Legacy IDs become live only after a request
  // authenticated with their own valid session token records this timestamp.
  const seen = user.activeSessionLastSeenAt;
  if (seen == null) return false;
  const age = now - new Date(seen).getTime();
  return Number.isFinite(age) && age >= -SESSION_ACTIVITY_TOUCH_MS && age < SESSION_ACTIVITY_TTL_MS;
}

export function shouldClearActiveSession(user: { activeSessionId?: string | null }, sessionId?: string | null): boolean {
  if (!sessionId) return false;
  return user.activeSessionId === sessionId;
}

// crypto.randomInt is CSPRNG-backed (unlike Math.random) — this is a login
// security control, not a UI nonce.
export function generateOtpCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

// Never store the plaintext code — only what's needed to check a guess
// against it. SHA-256 (not bcrypt) is deliberate: a 6-digit space is small
// enough that the real defense is the 3-attempt lockout + short TTL below,
// not a slow hash — bcrypt here would just add latency to every verify call
// for no real security gain against an attacker limited to 3 guesses.
export function hashOtp(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}
