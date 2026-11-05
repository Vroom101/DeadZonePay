/**
 * Hashes and ECDSA P-256 signatures over canonical JSON.
 *
 * hash(o)      = lowercase hex SHA-256 of utf8(canon(o))
 * sign(priv,o) = ECDSA P-256 (RFC 6979, deterministic) over the 32-byte SHA-256 digest of
 *                canon(o without its top-level `sig` and `sigs`), low-S, compact r||s hex
 *
 * Note: noble builds p256 with lowS: false, so low-S is requested explicitly on both
 * sign and verify. A high-S twin of a valid signature is rejected.
 */
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { canon } from './canonical';
import { TYPE, type Hash, type PubKey, type Sig, type VerifierId } from './types';

const PRIV_RE = /^[0-9a-f]{64}$/;
const PUB_RE = /^0[23][0-9a-f]{64}$/;
const SIG_RE = /^[0-9a-f]{128}$/;
const HASH_RE = /^[0-9a-f]{64}$/;

/** Injected randomness: returns n cryptographically random bytes. src/ never reads a global RNG. */
export type Rand = (n: number) => Uint8Array;

export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoError';
  }
}

// ---------------------------------------------------------------------------
// Format checks
// ---------------------------------------------------------------------------

export function isHash(x: unknown): x is Hash {
  return typeof x === 'string' && HASH_RE.test(x);
}

export function isPrivKey(x: unknown): x is string {
  return typeof x === 'string' && PRIV_RE.test(x) && p256.utils.isValidSecretKey(hexToBytes(x));
}

/** Compressed, lowercase, and a real point on P-256. */
export function isPubKey(x: unknown): x is PubKey {
  if (typeof x !== 'string' || !PUB_RE.test(x)) return false;
  try {
    return p256.utils.isValidPublicKey(hexToBytes(x), true);
  } catch {
    return false;
  }
}

export function isSig(x: unknown): x is Sig {
  return typeof x === 'string' && SIG_RE.test(x);
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/** SHA-256 of utf8(canon(o)), as bytes. Throws CanonError if o is not canonical-encodable. */
export function digest(o: unknown): Uint8Array {
  return sha256(utf8ToBytes(canon(o)));
}

/** SHA-256 of utf8(canon(o)), lowercase hex. */
export function hash(o: unknown): Hash {
  return bytesToHex(digest(o));
}

/** The part of a signed object that its signatures cover: everything except top-level `sig` and `sigs`. */
export function signingPayload<T extends object>(o: T): Omit<T, 'sig' | 'sigs'> {
  if (typeof o !== 'object' || o === null || Array.isArray(o)) {
    throw new CryptoError('only objects can be signed');
  }
  const { sig: _sig, sigs: _sigs, ...rest } = o as T & { sig?: unknown; sigs?: unknown };
  return rest;
}

/** hash(signingPayload(o)). This is spendHash, certHash and rosterHash. */
export function signingHash(o: object): Hash {
  return hash(signingPayload(o));
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

export function pubFromPriv(priv: string): PubKey {
  if (!isPrivKey(priv)) throw new CryptoError('invalid private key');
  return bytesToHex(p256.getPublicKey(hexToBytes(priv), true));
}

/** New private key from injected randomness (rejection sampling; invalid draws are ~2^-32 likely). */
export function privFromRandom(rand: Rand): string {
  for (let i = 0; i < 64; i++) {
    const bytes = rand(32);
    if (bytes.length === 32 && p256.utils.isValidSecretKey(bytes)) return bytesToHex(bytes);
  }
  throw new CryptoError('random source never produced a valid key');
}

/** hash({type:'VERIFIER_ID', pub}).slice(0, 16). Rosters must use exactly this id. */
export function verifierIdFromPub(pub: PubKey): VerifierId {
  return hash({ type: TYPE.VERIFIER_ID, pub }).slice(0, 16);
}

/** 16 random bytes as 32 hex chars, for mesh msgIds. */
export function randomId(rand: Rand): string {
  const bytes = rand(16);
  if (bytes.length !== 16) throw new CryptoError('random source returned the wrong length');
  return bytesToHex(bytes);
}

// ---------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------

/** Sign the payload of `o` (o minus sig/sigs). Deterministic: same key and payload give the same sig. */
export function sign(priv: string, o: object): Sig {
  if (!isPrivKey(priv)) throw new CryptoError('invalid private key');
  const d = digest(signingPayload(o));
  const s = p256.sign(d, hexToBytes(priv), { prehash: false, lowS: true });
  return bytesToHex(s.toBytes('compact'));
}

/**
 * True only if `sig` is a lowercase compact low-S signature by `pub` over the payload of `o`.
 * Never throws: malformed keys, signatures or non-canonical objects return false.
 */
export function verifySig(pub: unknown, o: object, sig: unknown): boolean {
  if (!isPubKey(pub) || !isSig(sig)) return false;
  try {
    const d = digest(signingPayload(o));
    const parsed = p256.Signature.fromBytes(hexToBytes(sig), 'compact');
    if (parsed.hasHighS()) return false;
    return p256.verify(parsed.toBytes('compact'), d, hexToBytes(pub), {
      prehash: false,
      lowS: true,
      format: 'compact',
    });
  } catch {
    return false;
  }
}
