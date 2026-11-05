import { createHash, createPublicKey, verify as nodeVerify } from 'node:crypto';
import { p256 } from '@noble/curves/nist.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import { canon } from '../src/canonical';
import {
  CryptoError,
  hash,
  isPubKey,
  isSig,
  privFromRandom,
  pubFromPriv,
  randomId,
  sign,
  signingHash,
  signingPayload,
  verifierIdFromPub,
  verifySig,
} from '../src/crypto';
import { seededRand, testKey } from './keys';

const customer = testKey('customer');
const chai = testKey('chai');

const spend = {
  version: 'dzp.spend.v1',
  reserveId: 'res-1',
  marketId: 'dzp-market-1',
  inputs: ['a'.repeat(64)],
  outputs: [
    { owner: chai.pub, amount: '300000000' },
    { owner: customer.pub, amount: '200000000' },
  ],
  memo: 'chai x2',
  createdAt: 1_793_000_000,
};

/** Verify with Node's OpenSSL: ECDSA P-256 over SHA-256(canon(payload)), IEEE P1363 (r||s) encoding. */
function opensslVerify(pub: string, o: object, sig: string): boolean {
  const point = p256.Point.fromHex(pub).toAffine();
  const toB64u = (n: bigint) => Buffer.from(n.toString(16).padStart(64, '0'), 'hex').toString('base64url');
  const key = createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: toB64u(point.x), y: toB64u(point.y) },
    format: 'jwk',
  });
  const data = Buffer.from(canon(signingPayload(o)), 'utf8');
  return nodeVerify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'hex'));
}

function highSTwin(sig: string): string {
  const s = p256.Signature.fromBytes(hexToBytes(sig), 'compact');
  const twin = new p256.Signature(s.r, p256.CURVE.n - s.s);
  expect(twin.hasHighS()).toBe(true);
  return bytesToHex(twin.toBytes('compact'));
}

describe('hash', () => {
  it('is SHA-256 of the canonical JSON, checked against Node crypto', () => {
    for (const v of [{}, [], spend, { b: 'é', a: [1, null, true] }]) {
      const expected = createHash('sha256').update(canon(v), 'utf8').digest('hex');
      expect(hash(v)).toBe(expected);
    }
  });

  it('matches the known SHA-256 of "{}"', () => {
    expect(hash({})).toBe('44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
  });

  it('signingHash ignores sig and sigs at the top level only', () => {
    const withSig = { ...spend, sig: 'f'.repeat(128) };
    const withSigs = { ...spend, sigs: { settler: 'x', cosigner: 'y' } };
    expect(signingHash(withSig)).toBe(hash(spend));
    expect(signingHash(withSigs)).toBe(hash(spend));
    const nested = { a: { sig: 'kept' } };
    expect(signingHash(nested)).toBe(hash(nested));
  });

  it('refuses to build a payload from non-objects', () => {
    expect(() => signingPayload([] as unknown as object)).toThrow(CryptoError);
    expect(() => signingPayload(null as unknown as object)).toThrow(CryptoError);
  });
});

describe('sign / verifySig', () => {
  it('round-trips and is deterministic (RFC 6979)', () => {
    const sig = sign(customer.priv, spend);
    expect(isSig(sig)).toBe(true);
    expect(sign(customer.priv, spend)).toBe(sig);
    expect(verifySig(customer.pub, spend, sig)).toBe(true);
  });

  it('produces standard ECDSA P-256/SHA-256 signatures that OpenSSL accepts', () => {
    const sig = sign(customer.priv, spend);
    expect(opensslVerify(customer.pub, spend, sig)).toBe(true);
    expect(opensslVerify(customer.pub, { ...spend, memo: 'x' }, sig)).toBe(false);
  });

  it('ignores an existing sig/sigs field when signing and verifying', () => {
    const sig = sign(customer.priv, spend);
    expect(sign(customer.priv, { ...spend, sig: 'junk' })).toBe(sig);
    expect(verifySig(customer.pub, { ...spend, sig }, sig)).toBe(true);
  });

  it('fails on any change to the payload', () => {
    const sig = sign(customer.priv, spend);
    expect(verifySig(customer.pub, { ...spend, memo: 'chai x3' }, sig)).toBe(false);
    expect(verifySig(customer.pub, { ...spend, createdAt: spend.createdAt + 1 }, sig)).toBe(false);
    const swapped = { ...spend, outputs: [spend.outputs[1]!, spend.outputs[0]!] };
    expect(verifySig(customer.pub, swapped, sig)).toBe(false);
    expect(verifySig(customer.pub, { ...spend, extra: 1 }, sig)).toBe(false);
  });

  it('fails for the wrong key', () => {
    expect(verifySig(chai.pub, spend, sign(customer.priv, spend))).toBe(false);
  });

  it('never produces high-S and rejects the high-S twin of a valid signature', () => {
    for (let i = 0; i < 64; i++) {
      const sig = sign(customer.priv, { ...spend, createdAt: i });
      expect(p256.Signature.fromBytes(hexToBytes(sig), 'compact').hasHighS()).toBe(false);
    }
    const sig = sign(customer.priv, spend);
    const twin = highSTwin(sig);
    expect(opensslVerify(customer.pub, spend, twin)).toBe(true); // valid ECDSA, but malleable
    expect(verifySig(customer.pub, spend, twin)).toBe(false);
  });

  it('rejects non-canonical signature encodings', () => {
    const sig = sign(customer.priv, spend);
    const der = bytesToHex(p256.Signature.fromBytes(hexToBytes(sig), 'compact').toBytes('der'));
    for (const bad of [sig.toUpperCase(), der, sig.slice(2), `${sig}00`, '', 42, null, '0'.repeat(128)]) {
      expect(verifySig(customer.pub, spend, bad)).toBe(false);
    }
  });

  it('rejects malformed or off-curve public keys without throwing', () => {
    const sig = sign(customer.priv, spend);
    const offCurve = `02${'f'.repeat(64)}`; // x >= field prime
    const uncompressed = bytesToHex(p256.getPublicKey(hexToBytes(customer.priv), false));
    for (const bad of [customer.pub.toUpperCase(), offCurve, uncompressed, `04${customer.pub.slice(2)}`, '', 7]) {
      expect(isPubKey(bad)).toBe(false);
      expect(verifySig(bad, spend, sig)).toBe(false);
    }
  });

  it('returns false (does not throw) for objects that cannot be canonically encoded', () => {
    const sig = sign(customer.priv, spend);
    expect(verifySig(customer.pub, { ...spend, createdAt: 1.5 }, sig)).toBe(false);
  });

  it('a signature over one message type never verifies as another (domain separation)', () => {
    const vote = { type: 'VOTE', spendHash: hash(spend), marketId: 'dzp-market-1', epoch: 1, verifierId: chai.verifierId };
    const voteSig = sign(chai.priv, vote);
    expect(verifySig(chai.pub, vote, voteSig)).toBe(true);
    expect(verifySig(chai.pub, { ...vote, type: 'REFUSE' }, voteSig)).toBe(false);
    expect(verifySig(chai.pub, spend, voteSig)).toBe(false);
  });

  it('refuses to sign with an invalid private key', () => {
    expect(() => sign('00'.repeat(32), spend)).toThrow(CryptoError);
    expect(() => sign('zz', spend)).toThrow(CryptoError);
    expect(() => sign(customer.priv.toUpperCase(), spend)).toThrow(CryptoError);
  });
});

describe('keys and ids', () => {
  it('derives compressed lowercase public keys', () => {
    expect(isPubKey(customer.pub)).toBe(true);
    expect(pubFromPriv(customer.priv)).toBe(customer.pub);
  });

  it('privFromRandom skips invalid draws and fails on a broken source', () => {
    let calls = 0;
    const firstZero = (n: number) => (calls++ === 0 ? new Uint8Array(n) : seededRand('k')(n));
    expect(isPubKey(pubFromPriv(privFromRandom(firstZero)))).toBe(true);
    expect(calls).toBe(2);
    expect(() => privFromRandom((n) => new Uint8Array(n))).toThrow(CryptoError);
  });

  it('verifierId is 16 hex chars derived from the pub', () => {
    expect(customer.verifierId).toMatch(/^[0-9a-f]{16}$/);
    expect(verifierIdFromPub(customer.pub)).toBe(hash({ type: 'VERIFIER_ID', pub: customer.pub }).slice(0, 16));
    expect(customer.verifierId).not.toBe(chai.verifierId);
  });

  it('randomId gives 32 hex chars from injected randomness', () => {
    expect(randomId(seededRand('m'))).toMatch(/^[0-9a-f]{32}$/);
    expect(() => randomId(() => new Uint8Array(3))).toThrow(CryptoError);
  });
});
