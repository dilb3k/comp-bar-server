import type { AuthUser } from "../modules/auth/auth.types";
import { env } from "../config/env";
import { AppError } from "./app-error";

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
// Matches a trailing timezone designator: "Z", "+05:00", "-0500", etc.
const TIMEZONE_SUFFIX_REGEX = /(Z|[+-]\d{2}:?\d{2})$/;

function toDate(value?: string | Date) {
  if (!value) {
    return new Date();
  }

  if (value instanceof Date) {
    return new Date(value);
  }

  if (ISO_DATE_REGEX.test(value)) {
    return new Date(`${value}T00:00:00.000Z`);
  }

  // Naive datetimes (no timezone) must be interpreted as UTC so that the
  // business-day boundary is deterministic and never drifts with the server's
  // local timezone. The timezone shift is applied explicitly via
  // timezoneOffsetMinutes in the callers.
  if (!TIMEZONE_SUFFIX_REGEX.test(value)) {
    return new Date(`${value}Z`);
  }

  return new Date(value);
}

function formatDayKey(date: Date) {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getEffectiveHour(actor: AuthUser): number {
  const active = actor.businessDayStartHour ?? env.BUSINESS_DAY_START_HOUR;
  if (actor.pendingBusinessDayStartHour != null && actor.businessDayEffectiveFrom) {
    if (new Date() >= new Date(actor.businessDayEffectiveFrom)) {
      return actor.pendingBusinessDayStartHour;
    }
  }
  return active;
}

export function isValidDayKey(value: string) {
  return ISO_DATE_REGEX.test(value);
}

export function getBusinessDate(
  value?: string | Date,
  businessDayStartHour = 0,
  timezoneOffsetMinutes = 0
) {
  const date = toDate(value);
  const localMs = date.getTime() + timezoneOffsetMinutes * 60 * 1000;
  const shifted = new Date(localMs);

  if (shifted.getUTCHours() < businessDayStartHour) {
    shifted.setUTCDate(shifted.getUTCDate() - 1);
  }

  return formatDayKey(shifted);
}

export function getCurrentBusinessDate(businessDayStartHour = 6, timezoneOffsetMinutes = 0) {
  return getBusinessDate(new Date(), businessDayStartHour, timezoneOffsetMinutes);
}

/**
 * The instant at which "tomorrow's" business day begins for the given hour,
 * as a real UTC Date — i.e. when a scheduled business-day hour change should
 * take effect.
 *
 * Must go through timezoneOffsetMinutes like every other business-date
 * computation here. Building it with `new Date().setHours(hour, 0, 0, 0)`
 * instead resolves the hour in the *server's* timezone (UTC on Render), so for
 * a UTC+5 business the change landed 5 hours late and disagreed with the day
 * keys produced by getBusinessDate().
 */
export function getNextBusinessDayStart(
  businessDayStartHour: number,
  timezoneOffsetMinutes = 0,
  from: Date = new Date()
) {
  const offsetMs = timezoneOffsetMinutes * 60 * 1000;
  const local = new Date(from.getTime() + offsetMs);
  const tomorrowLocal = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() + 1,
    businessDayStartHour,
    0,
    0,
    0
  );
  return new Date(tomorrowLocal - offsetMs);
}

export function compareDayKeys(left: string, right: string) {
  return left.localeCompare(right);
}

export function assertNotFutureDayKey(
  date: string,
  currentBusinessDate: string,
  message = "Future dates are not allowed"
) {
  if (compareDayKeys(date, currentBusinessDate) > 0) {
    throw new AppError(message, 409);
  }
}

export function isPastBusinessDate(date: string, currentBusinessDate: string) {
  return compareDayKeys(date, currentBusinessDate) < 0;
}

export function getBusinessDateFromTimestamp(
  value: Date | string,
  businessDayStartHour = 0,
  timezoneOffsetMinutes = 0
) {
  return getBusinessDate(value, businessDayStartHour, timezoneOffsetMinutes);
}

/**
 * "Statistika & Reyting" (historical date-range reports) is a paid-only
 * feature — every client hides it behind a tier check, but that's UI-only,
 * so every read endpoint that can return a date range has to enforce it
 * server-side too, or a "tekin" caller can just hit the API directly.
 *
 * A single explicit day stays free — that's the daily Inventory/Statistika
 * screen, core functionality every tier gets. Anything wider is a paid
 * report, and "wider" includes a *missing* bound: `from`/`to` both absent
 * (or only one present) must NOT silently fall through as "not a range" —
 * that was exactly the shape that returned a tekin caller's entire history
 * (see inventory.service.ts's former inline `from && to && from !== to`
 * check, and the identical gap this same policy had in
 * snapshot.service.ts's getRange, which had no gate at all).
 *
 * Shared here (rather than reimplemented per module) so the policy can only
 * drift out of sync with itself by forgetting to call this in a new range
 * endpoint, not by two copies quietly disagreeing the way inventory's and
 * snapshots' independently-written checks just did.
 */
export function assertPaidRangeAllowed(actor: AuthUser, from?: string, to?: string) {
  if (actor.tier !== "tekin") return;
  if (!from || !to || from !== to) {
    throw new AppError(
      "Bu davr uchun hisobot faqat pullik tarif egalari uchun mavjud",
      402,
    );
  }
}
