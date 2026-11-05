import { describe, expect, it } from 'vitest';
import { canon, CanonError } from '../src/canonical';

describe('canon: accepted values', () => {
  it('sorts keys at every depth and drops whitespace', () => {
    expect(canon({ b: 1, a: [{ d: 2, c: 'x' }], c: { z: null, y: true } })).toBe(
      '{"a":[{"c":"x","d":2}],"b":1,"c":{"y":true,"z":null}}',
    );
  });

  it('is independent of key insertion order', () => {
    const one = { version: 'dzp.spend.v1', amount: '300000000', inputs: ['a', 'b'] };
    const two = { inputs: ['a', 'b'], amount: '300000000', version: 'dzp.spend.v1' };
    expect(canon(one)).toBe(canon(two));
  });

  it('keeps array order (arrays are not sorted)', () => {
    expect(canon(['b', 'a'])).toBe('["b","a"]');
    expect(canon(['b', 'a'])).not.toBe(canon(['a', 'b']));
  });

  it('sorts keys by UTF-16 code unit, so "10" sorts before "9" and uppercase before lowercase', () => {
    expect(canon({ '9': 1, '10': 2, a: 3, B: 4 })).toBe('{"10":2,"9":1,"B":4,"a":3}');
  });

  it('encodes primitives', () => {
    expect(canon(null)).toBe('null');
    expect(canon(true)).toBe('true');
    expect(canon(false)).toBe('false');
    expect(canon(0)).toBe('0');
    expect(canon(-0)).toBe('0');
    expect(canon(-42)).toBe('-42');
    expect(canon(Number.MAX_SAFE_INTEGER)).toBe('9007199254740991');
    expect(canon('')).toBe('""');
    expect(canon({})).toBe('{}');
    expect(canon([])).toBe('[]');
  });

  it('escapes strings exactly like JSON.stringify, including quotes, control chars and unicode', () => {
    const s = 'chai "masala"\n\tnaïve ₹ 😀 \u0000';
    expect(canon(s)).toBe(JSON.stringify(s));
    expect(canon({ memo: s })).toBe(`{"memo":${JSON.stringify(s)}}`);
  });

  it('accepts properly paired surrogates (emoji)', () => {
    expect(canon('😀')).toBe('"😀"');
  });

  it('accepts null-prototype objects', () => {
    const o = Object.create(null) as Record<string, unknown>;
    o.b = 1;
    o.a = 2;
    expect(canon(o)).toBe('{"a":2,"b":1}');
  });

  it('round-trips through JSON.parse to the same canonical string', () => {
    const v = { z: [1, { y: 'é', x: [] }], a: { c: null, b: false } };
    expect(canon(JSON.parse(canon(v)))).toBe(canon(v));
  });

  it('allows the same object twice when it is not a cycle', () => {
    const shared = { a: 1 };
    expect(canon({ x: shared, y: shared })).toBe('{"x":{"a":1},"y":{"a":1}}');
  });
});

describe('canon: rejected values', () => {
  const rejects: [string, unknown][] = [
    ['float', 1.5],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['bigint', 10n],
    ['undefined', undefined],
    ['function', () => 1],
    ['symbol', Symbol('x')],
    ['Date', new Date(0)],
    ['Map', new Map()],
    ['Uint8Array', new Uint8Array(2)],
    ['class instance', new (class Foo { a = 1 })()],
    ['undefined property', { a: undefined }],
    ['nested float', { amount: { value: 0.1 } }],
    ['float in array', [1, 2.5]],
    // eslint-disable-next-line no-sparse-arrays
    ['sparse array', [1, , 3]],
    ['symbol key', { [Symbol('k')]: 1 }],
    ['lone high surrogate', 'a\ud800b'],
    ['lone low surrogate', '\udc00'],
    ['high surrogate at end', 'x\ud83d'],
    ['reversed surrogate pair', '\ude00\ud83d'],
    ['lone surrogate in a key', { '\ud800': 1 }],
    ['getter', { get x() { return 1; } }],
    ['array index getter', Object.defineProperty([0], '0', { get: () => 2, enumerable: true })],
    ['array with extra property', Object.assign([1], { amount: '5' })],
    ['non-enumerable property', Object.defineProperty({}, 'amount', { value: '1', enumerable: false })],
  ];

  for (const [name, value] of rejects) {
    it(`rejects ${name}`, () => {
      expect(() => canon(value)).toThrow(CanonError);
    });
  }

  it('rejects cycles', () => {
    const a: Record<string, unknown> = { x: 1 };
    a.self = a;
    expect(() => canon(a)).toThrow(/cycle/);
  });

  it('reports the path of the bad value', () => {
    expect(() => canon({ outputs: [{ amount: 1.5 }] })).toThrow(/\.outputs\[0\]\.amount/);
  });
});
