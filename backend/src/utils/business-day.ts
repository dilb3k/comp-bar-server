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

export function isValidDayKey(value: string) {
  return ISO_DATE_REGEX.test(value);
}

export function getBusinessDate(
  value?: string | Date,
  businessDayStartHour = 7
) {
  const date = toDate(value);
  const shifted = new Date(date);

  if (shifted.getHours() < businessDayStartHour) {
    shifted.setDate(shifted.getDate() - 1);
  }

  return formatDayKey(shifted);
}

export function getCurrentBusinessDate(businessDayStartHour = 7) {
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
    throw new Error(message);
  }
}

export function isPastBusinessDate(date: string, currentBusinessDate: string) {
  return compareDayKeys(date, currentBusinessDate) < 0;
}

export function getBusinessDateFromTimestamp(
  value: Date | string,
  businessDayStartHour = 7
) {
  return getBusinessDate(value, businessDayStartHour);
}
