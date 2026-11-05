import { describe, expect, it } from 'vitest';
import {
  AmountError,
  formatHbar,
  hbarToTinybar,
  isTinybar,
  parseTinybar,
  sumTinybars,
  toTinybar,
} from '../src/amount';

describe('tinybar strings', () => {
  it('accepts positive canonical integers up to int64 max', () => {
    expect(parseTinybar('1')).toBe(1n);
    expect(parseTinybar('500000000')).toBe(500_000_000n);
    expect(parseTinybar('9223372036854775807')).toBe(9_223_372_036_854_775_807n);
  });

  const bad: unknown[] = [
    '0', '-1', '+1', '01', '1.0', '1e8', ' 1', '1 ', '', '0x10',
    '9223372036854775808', '99999999999999999999', 1, 1n, null, undefined, '١٢',
  ];
  for (const b of bad) {
    it(`rejects ${JSON.stringify(typeof b === 'bigint' ? `${b}n` : b) ?? String(b)}`, () => {
      expect(isTinybar(b)).toBe(false);
      expect(() => parseTinybar(b)).toThrow(AmountError);
    });
  }

  it('formats only positive in-range bigints', () => {
    expect(toTinybar(300_000_000n)).toBe('300000000');
    expect(() => toTinybar(0n)).toThrow(AmountError);
    expect(() => toTinybar(-5n)).toThrow(AmountError);
    expect(() => toTinybar(9_223_372_036_854_775_808n)).toThrow(AmountError);
  });

  it('sums exactly with bigint (no float drift)', () => {
    expect(sumTinybars(['300000000', '150000000', '20000000'])).toBe(470_000_000n);
    expect(() => sumTinybars(['1', '0'])).toThrow(AmountError);
  });
});

describe('HBAR conversion', () => {
  it('converts the demo amounts exactly', () => {
    expect(hbarToTinybar('5')).toBe(500_000_000n);
    expect(hbarToTinybar('3')).toBe(300_000_000n);
    expect(hbarToTinybar('1.5')).toBe(150_000_000n);
    expect(hbarToTinybar('0.2')).toBe(20_000_000n);
    expect(hbarToTinybar('2.2')).toBe(220_000_000n);
    expect(hbarToTinybar('0.3')).toBe(30_000_000n);
    expect(hbarToTinybar('0.00000001')).toBe(1n);
  });

  it('rejects more than 8 decimals and malformed input', () => {
    for (const s of ['0.000000001', '1.', '.5', '-1', '01', '1,5', 'abc', '']) {
      expect(() => hbarToTinybar(s)).toThrow(AmountError);
    }
  });

  it('formats without trailing zeros', () => {
    expect(formatHbar(220_000_000n)).toBe('2.2');
    expect(formatHbar(500_000_000n)).toBe('5');
    expect(formatHbar(1n)).toBe('0.00000001');
    expect(formatHbar(0n)).toBe('0');
  });
});
