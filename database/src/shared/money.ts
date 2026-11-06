import { ValidationError } from './errors';

/**
 * Money = integer MINOR units + ISO-4217 code. No floating point anywhere.
 * Extend this table deliberately when a currency is supported (exponent = digits after the decimal point).
 */
const EXPONENTS: Readonly<Record<string, number>> = { INR: 2, USD: 2 };

export function currencyExponent(currency: string): number {
  const e = EXPONENTS[currency];
  if (e === undefined) throw new ValidationError(`Unsupported currency ${currency}`);
  return e;
}

/** 49900 (INR minor) -> "499.00": the decimal-string format PayU expects for `amount`. */
export function minorToDecimalString(minor: number, currency: string): string {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new ValidationError('Amount must be a non-negative integer of minor units');
  const exp = currencyExponent(currency);
  const s = String(minor).padStart(exp + 1, '0');
  return exp === 0 ? s : `${s.slice(0, -exp)}.${s.slice(-exp)}`;
}

/** "499.00" -> 49900. Strict: exact digits only; rejects "499.5", "1e3", "-1", spaces. */
export function decimalStringToMinor(value: string, currency: string): number {
  const exp = currencyExponent(currency);
  const re = exp === 0 ? /^\d+$/ : new RegExp(`^\\d+\\.\\d{${exp}}$`);
  if (!re.test(value)) throw new ValidationError(`Invalid ${currency} amount "${value}"; expected exactly ${exp} decimal places`);
  const minor = Number(value.replace('.', ''));
  if (!Number.isSafeInteger(minor)) throw new ValidationError('Amount out of range');
  return minor;
}
