/**
 * Canonical JSON: the one byte string every phone, the backend and the cosigner hash and sign.
 *
 * - Object keys sorted by UTF-16 code unit (JavaScript's default sort), no whitespace.
 * - Numbers must be safe integers (amounts are decimal strings, never numbers).
 * - Strings use JSON.stringify escaping. Strings with an unpaired UTF-16 surrogate are rejected:
 *   engines differ on how they encode them, which would make phones and backend hash differently.
 * - Only plain objects, arrays, strings, safe integers, booleans and null are allowed.
 *   undefined, floats, NaN, Infinity, bigint, functions, symbols, Dates, Maps, typed
 *   arrays, sparse arrays, symbol keys, getters, non-enumerable properties and cycles all
 *   throw CanonError, so two
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
      if (hasLoneSurrogate(value)) throw new CanonError('unpaired surrogate in string', path);
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

function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++;
        continue;
      }
      return true;
    }
    if (c >= 0xdc00 && c <= 0xdfff) return true;
  }
  return false;
}

function encodeArray(arr: unknown[], path: string, stack: Set<object>): string {
  if (Object.getPrototypeOf(arr) !== Array.prototype) throw new CanonError('not a plain array', path);
  // Only index data properties plus `length`: no getters, no extra named properties that
  // would silently vanish from the encoding.
  const descriptors = Object.getOwnPropertyDescriptors(arr) as Record<string, PropertyDescriptor>;
  if (Object.keys(descriptors).length !== arr.length + 1) {
    throw new CanonError('array with holes or extra properties', path);
  }
  const parts: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    const desc = descriptors[String(i)];
    if (!desc) throw new CanonError('sparse array', `${path}[${i}]`);
    if (desc.get || desc.set) throw new CanonError('accessor property', `${path}[${i}]`);
    parts.push(encode(desc.value, `${path}[${i}]`, stack));
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
  // Read own data properties only: accessors could return a different value on every read,
  // and non-enumerable properties would silently vanish from the encoding.
  const descriptors = Object.getOwnPropertyDescriptors(obj) as Record<string, PropertyDescriptor>;
  const keys = Object.keys(descriptors).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const desc = descriptors[key]!;
    const childPath = `${path}.${key}`;
    if (desc.get || desc.set) throw new CanonError('accessor property', childPath);
    if (!desc.enumerable) throw new CanonError('non-enumerable property', childPath);
    const child: unknown = desc.value;
    if (hasLoneSurrogate(key)) throw new CanonError('unpaired surrogate in key', childPath);
    if (child === undefined) throw new CanonError('undefined value', childPath);
    parts.push(`${JSON.stringify(key)}:${encode(child, childPath, stack)}`);
  }
  return `{${parts.join(',')}}`;
}
