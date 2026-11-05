/**
 * Canonical JSON: the one byte string every phone, the backend and the cosigner hash and sign.
 *
 * - Object keys sorted by UTF-16 code unit (JavaScript's default sort), no whitespace.
 * - Numbers must be safe integers (amounts are decimal strings, never numbers).
 * - Strings use JSON.stringify escaping (lone surrogates come out as \uXXXX escapes).
 * - Only plain objects, arrays, strings, safe integers, booleans and null are allowed.
 *   undefined, floats, NaN, Infinity, bigint, functions, symbols, Dates, Maps, typed
 *   arrays, sparse arrays, symbol keys and cycles all throw CanonError, so two
 *   different values can never encode to the same string by accident.
 */

export class CanonError extends Error {
  constructor(message: string, readonly path: string) {
    super(`${message} at ${path || '<root>'}`);
    this.name = 'CanonError';
  }
}

export function canon(value: unknown): string {
  return encode(value, '', new Set<object>());
}

function encode(value: unknown, path: string, stack: Set<object>): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isSafeInteger(value)) {
        throw new CanonError(`not a safe integer (${String(value)})`, path);
      }
      // -0 encodes as 0: they are the same integer.
      return Object.is(value, -0) ? '0' : String(value);
    case 'string':
      return JSON.stringify(value);
    case 'object':
      break;
    default:
      throw new CanonError(`unsupported type ${typeof value}`, path);
  }

  const obj = value as object;
  if (stack.has(obj)) throw new CanonError('cycle', path);
  stack.add(obj);
  try {
    if (Array.isArray(obj)) return encodeArray(obj, path, stack);
    return encodeObject(obj, path, stack);
  } finally {
    stack.delete(obj);
  }
}

function encodeArray(arr: unknown[], path: string, stack: Set<object>): string {
  const parts: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (!(i in arr)) throw new CanonError('sparse array', `${path}[${i}]`);
    parts.push(encode(arr[i], `${path}[${i}]`, stack));
  }
  return `[${parts.join(',')}]`;
}

function encodeObject(obj: object, path: string, stack: Set<object>): string {
  const proto = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) {
    throw new CanonError('not a plain object', path);
  }
  if (Object.getOwnPropertySymbols(obj).length > 0) {
    throw new CanonError('symbol keys', path);
  }
  const record = obj as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const child = record[key];
    const childPath = `${path}.${key}`;
    if (child === undefined) throw new CanonError('undefined value', childPath);
    parts.push(`${JSON.stringify(key)}:${encode(child, childPath, stack)}`);
  }
  return `{${parts.join(',')}}`;
}
