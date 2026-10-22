/**
 * Phone helpers. Default country is Brazil (+55), but every function takes
 * the country code as a parameter so switching markets later doesn't
 * require touching this file's logic.
 */

export const DEFAULT_COUNTRY_CODE = '55';

/** Strips everything but digits. */
export function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

/** Keeps only digits and caps the length at 11 (DDD + up to 9-digit number). */
export function sanitizeLocalPhoneInput(rawValue: string): string {
  return onlyDigits(rawValue).slice(0, 11);
}

/**
 * Formats a local Brazilian number with a *fixed* mask: "DD DDDDD-DDDD" for
 * mobile numbers, "DD DDDD-DDDD" for landlines. Used both for the editable
 * field and for read-only display, so there's a single source of truth for
 * where the hyphen goes.
 *
 * The group size (5 digits before the hyphen for mobile, 4 for landline) is
 * decided from the *first local digit* — mobile numbers in Brazil always
 * start with 9 right after the DDD — not from the final total length. That
 * used to be the bug: deciding "mobile vs. landline" by checking whether
 * the finished number was longer than 8 digits meant the grouping flipped
 * mid-typing, right as the person typed the number's last digit, which is
 * what made the hyphen jump and reshuffle digits that were already placed.
 * Deciding from the first digit means the hyphen's position is locked in
 * the moment it's known, and never moves again for the rest of the edit.
 */
export function formatPhoneNumber(rawValue: string): string {
  const digits = sanitizeLocalPhoneInput(rawValue);
  const ddd = digits.slice(0, 2);
  const rest = digits.slice(2);

  if (rest.length === 0) return ddd;

  const groupSize = rest[0] === '9' ? 5 : 4;
  const firstGroup = rest.slice(0, groupSize);
  const secondGroup = rest.slice(groupSize);

  if (secondGroup.length === 0) return `${ddd} ${firstGroup}`;
  return `${ddd} ${firstGroup}-${secondGroup}`;
}

/**
 * Validates a local Brazilian number: 2-digit DDD + 8 or 9-digit number.
 * DDD must be a real Brazilian area code range (11-99).
 */
export function isValidLocalPhone(rawValue: string): boolean {
  const digits = onlyDigits(rawValue);
  if (digits.length !== 10 && digits.length !== 11) return false;

  const ddd = Number(digits.slice(0, 2));
  if (ddd < 11 || ddd > 99) return false;

  // Mobile numbers in Brazil start with 9 after the DDD.
  if (digits.length === 11 && digits[2] !== '9') return false;

  return true;
}

/**
 * Builds the full E.164-ish digit string (country code + local number)
 * used to open WhatsApp, e.g. "55" + "44999999999" -> "5544999999999".
 */
export function toFullPhoneDigits(
  rawLocalValue: string,
  countryCode: string = DEFAULT_COUNTRY_CODE
): string {
  return `${countryCode}${onlyDigits(rawLocalValue)}`;
}
