import { Schema, model, models } from "mongoose";

// A short-lived OTP challenge issued when a login attempt collides with an
// already-active session on a different, not-yet-trusted device (see
// phoneVerificationRequired in auth.utils.ts). Replaces "type your own phone
// number back" (still the fallback for a user with no linked Telegram) with
// an actual single-use, time-limited code delivered out-of-band — knowing
// the account's phone number is no longer enough to take over a live
// session.
export interface ISessionChallenge {
  userId: string;
  securityVersion: number;
  otpHash: string; // sha256 of the 6-digit code — the code itself is never stored
  deviceId?: string | null;
  attempts: number;
  consumed: boolean;
  expiresAt: Date;
  createdAt: Date;
}

const sessionChallengeSchema = new Schema<ISessionChallenge>(
  {
    userId: { type: String, required: true, index: true },
    securityVersion: { type: Number, required: true },
    otpHash: { type: String, required: true },
    deviceId: { type: String, default: null },
    attempts: { type: Number, default: 0 },
    consumed: { type: Boolean, default: false },
    expiresAt: { type: Date, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "session_challenges", versionKey: false },
);

// expireAfterSeconds: 0 on a Date field means "expire exactly at that
// timestamp", not "N seconds after creation" — each challenge carries its
// own TTL (createdAt + OTP_TTL_MS) that all be different if that ever
// changes, rather than baking a fixed window into the index itself.
sessionChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const SessionChallengeModel =
  models.SessionChallenge ?? model<ISessionChallenge>("SessionChallenge", sessionChallengeSchema);
