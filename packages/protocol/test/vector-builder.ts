/**
 * Builds test/vectors.json: fixed keys, one sample of every signed message type, and the
 * expected canonical strings, hashes and signatures. Deterministic (RFC 6979 signatures,
 * keys derived from labels), so regenerating must produce no diff.
 */
import { hbarToTinybar } from '../src/amount';
import { canon } from '../src/canonical';
import { hash, sign, signingHash } from '../src/crypto';
import type { CanonVector, SignatureVector, VectorFile } from '../src/selftest';
import { TYPE, VERSION } from '../src/types';
import { testKey, type TestKey } from './keys';

const MARKET = 'dzp-market-1';
const T0 = 1_793_000_000; // fixed Unix seconds, so vectors never change

function signedBy<T extends object>(key: TestKey, o: T): T & { sig: string } {
  return { ...o, sig: sign(key.priv, o) };
}

export function buildVectors(): VectorFile {
  const settler = testKey('settler');
  const cosigner = testKey('cosigner');
  const customer = testKey('customer');
  const chai = testKey('chai');
  const grocery = testKey('grocery');
  const veg = testKey('veg');
  const phones: [TestKey, string, string][] = [
    [customer, 'Customer', '0.0.1001'],
    [chai, 'Chai stall', '0.0.1002'],
    [grocery, 'Grocery', '0.0.1003'],
    [veg, 'Vegetable stall', '0.0.1004'],
  ];

  const rosterBody = {
    version: VERSION.ROSTER,
    marketId: MARKET,
    epoch: 1,
    threshold: 3,
    verifiers: phones.map(([k]) => ({ id: k.verifierId, pub: k.pub })),
    participants: phones.map(([k, name, hederaAccount]) => ({ pub: k.pub, name, hederaAccount })),
  };
  const roster = {
    ...rosterBody,
    sigs: { settler: sign(settler.priv, rosterBody), cosigner: sign(cosigner.priv, rosterBody) },
  };
  const rosterHash = signingHash(roster);

  const certBody = {
    version: VERSION.RESERVE,
    reserveId: 'reserve-0001',
    hederaAccount: '0.0.2001',
    amount: hbarToTinybar('5').toString(),
    ownerPub: customer.pub,
    marketId: MARKET,
    rosterHash,
    issuedAt: T0,
    expiresAt: T0 + 86_400,
  };
  const cert = {
    ...certBody,
    sigs: { settler: sign(settler.priv, certBody), cosigner: sign(cosigner.priv, certBody) },
  };
  const certHash = signingHash(cert);
  const genesisId = hash({ type: TYPE.GENESIS, certHash });

  const spend = signedBy(customer, {
    version: VERSION.SPEND,
    reserveId: cert.reserveId,
    marketId: MARKET,
    inputs: [genesisId],
    outputs: [
      { owner: chai.pub, amount: hbarToTinybar('3').toString() },
      { owner: customer.pub, amount: hbarToTinybar('2').toString() },
    ],
    memo: 'chai',
    createdAt: T0 + 600,
  });
  const spendHash = signingHash(spend);

  const vote = signedBy(chai, { type: TYPE.VOTE, spendHash, marketId: MARKET, epoch: 1, verifierId: chai.verifierId });
  const invoice = signedBy(chai, {
    type: TYPE.INVOICE,
    marketId: MARKET,
    invoiceId: 'c'.repeat(32),
    to: chai.pub,
    amount: hbarToTinybar('3').toString(),
    memo: 'chai',
    createdAt: T0 + 590,
  });
  const hello = signedBy(grocery, {
    type: TYPE.HELLO,
    marketId: MARKET,
    verifierId: grocery.verifierId,
    pub: grocery.pub,
    name: 'Grocery',
    ts: T0 + 60,
  });
  const refuse = signedBy(veg, {
    type: TYPE.REFUSE,
    spendHash,
    verifierId: veg.verifierId,
    reason: 'note already spent',
  });
  const closeRequest = signedBy(settler, {
    type: TYPE.CLOSE_REQUEST,
    reserveId: cert.reserveId,
    marketId: MARKET,
    certHash,
    requestedAt: T0 + 7_200,
  });
  const attestation = signedBy(veg, {
    type: TYPE.CLOSED,
    reserveId: cert.reserveId,
    marketId: MARKET,
    certHash,
    verifierId: veg.verifierId,
    locks: [{ noteId: genesisId, spendHash }],
    spends: [spend],
  });

  const canonCases: [string, unknown][] = [
    ['key order and nesting', { b: 1, a: [{ d: 2, c: 'x' }], c: { z: null, y: true } }],
    ['unicode and escapes', { memo: 'chai "masala" ₹ naïve 😀\n\t' }],
    ['integers', { zero: 0, neg: -1, max: 9_007_199_254_740_991 }],
    ['empty object and array', { a: {}, b: [] }],
    ['verifier id preimage', { type: TYPE.VERIFIER_ID, pub: customer.pub }],
    ['genesis note id', { type: TYPE.GENESIS, certHash }],
    ['output note id 0', { type: TYPE.NOTE, spendHash, index: 0 }],
    ['output note id 1', { type: TYPE.NOTE, spendHash, index: 1 }],
  ];
  const canonVectors: CanonVector[] = canonCases.map(([name, value]) => ({
    name,
    value,
    canon: canon(value),
    hash: hash(value),
  }));

  const sigCases: [string, TestKey, Record<string, unknown>, string][] = [
    ['roster (settler)', settler, roster, roster.sigs.settler],
    ['roster (cosigner)', cosigner, roster, roster.sigs.cosigner],
    ['reserve certificate (settler)', settler, cert, cert.sigs.settler],
    ['reserve certificate (cosigner)', cosigner, cert, cert.sigs.cosigner],
    ['spend', customer, spend, spend.sig],
    ['vote', chai, vote, vote.sig],
    ['invoice', chai, invoice, invoice.sig],
    ['hello', grocery, hello, hello.sig],
    ['refuse', veg, refuse, refuse.sig],
    ['close request', settler, closeRequest, closeRequest.sig],
    ['close attestation', veg, attestation, attestation.sig],
  ];
  const signatures: SignatureVector[] = sigCases.map(([name, key, object, sig]) => ({
    name,
    signer: key.label,
    object,
    signingHash: signingHash(object),
    sig,
  }));

  return {
    version: 'dzp.vectors.v1',
    note: 'TEST KEYS ONLY. Derived from the public labels "dzp-test-key:<label>"; never use them for real funds.',
    keys: [settler, cosigner, customer, chai, grocery, veg],
    canon: canonVectors,
    signatures,
    hbar: ['5', '3', '2', '1.5', '1', '0.5', '0.3', '0.2', '2.2', '2.5', '0.00000001'].map((h) => ({
      hbar: h,
      tinybar: hbarToTinybar(h).toString(),
    })),
  };
}
