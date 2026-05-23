import type { AuthUser } from "../modules/auth/auth.types";
import { env } from "../config/env";
import { AppError } from "./app-error";

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function toDate(value?: string | Date) {
  if (!value) {
    return new Date();
  }

  if (value instanceof Date) {
    return new Date(value);
  }

  if (ISO_DATE_REGEX.test(value)) {
    return new Date(`${value}T00:00:00`);
  }

  return new Date(value);
}

function formatDayKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
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
  businessDayStartHour = 0
) {
  const date = toDate(value);
  const shifted = new Date(date);

  if (shifted.getHours() < businessDayStartHour) {
    shifted.setDate(shifted.getDate() - 1);
  }

  return formatDayKey(shifted);
}

export function getCurrentBusinessDate(businessDayStartHour = 6) {
  return getBusinessDate(new Date(), businessDayStartHour);
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
  businessDayStartHour = 0
) {
  return getBusinessDate(value, businessDayStartHour);
}
