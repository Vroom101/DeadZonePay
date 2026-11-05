/**
 * Tinybar amounts. Strings at every boundary (JSON, signatures, Hedera), bigint inside.
 * 1 HBAR = 100,000,000 tinybars.
 */
import { LIMITS, type Tinybar } from './types';

export const TINYBARS_PER_HBAR = 100_000_000n;

const TINYBAR_RE = /^[1-9][0-9]*$/;
const HBAR_RE = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,8}))?$/;

export class AmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AmountError';
  }
}

/** True if `s` is a valid Tinybar: positive, no sign, no leading zeros, at most int64 max. */
export function isTinybar(s: unknown): s is Tinybar {
  if (typeof s !== 'string' || !TINYBAR_RE.test(s) || s.length > 19) return false;
  return BigInt(s) <= LIMITS.MAX_TINYBAR;
}

/** Parse a Tinybar string. Throws AmountError on anything but a positive canonical integer. */
export function parseTinybar(s: unknown): bigint {
  if (!isTinybar(s)) throw new AmountError(`not a positive tinybar amount: ${String(s)}`);
  return BigInt(s);
}

/** Format a positive bigint as a Tinybar string. */
export function toTinybar(n: bigint): Tinybar {
  if (typeof n !== 'bigint' || n <= 0n || n > LIMITS.MAX_TINYBAR) {
    throw new AmountError(`tinybar amount out of range: ${String(n)}`);
  }
  return n.toString();
}

/** "2.2" (HBAR, at most 8 decimals) -> 220000000n. For UI input and test scenarios. */
export function hbarToTinybar(hbar: string): bigint {
  const m = HBAR_RE.exec(hbar);
  if (!m) throw new AmountError(`not an HBAR amount: ${hbar}`);
  const whole = BigInt(m[1]!);
  const frac = BigInt((m[2] ?? '').padEnd(8, '0'));
  return whole * TINYBARS_PER_HBAR + frac;
}

/** 220000000n -> "2.2". Trailing zeros dropped; whole numbers have no decimal point. */
export function formatHbar(tinybars: bigint): string {
  const neg = tinybars < 0n;
  const abs = neg ? -tinybars : tinybars;
  const whole = abs / TINYBARS_PER_HBAR;
  const frac = (abs % TINYBARS_PER_HBAR).toString().padStart(8, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/** Sum of Tinybar strings as bigint. Throws on any invalid entry. */
export function sumTinybars(amounts: readonly unknown[]): bigint {
  let total = 0n;
  for (const a of amounts) total += parseTinybar(a);
  return total;
}
