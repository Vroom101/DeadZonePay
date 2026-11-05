/**
 * Checks a vectors file (packages/protocol/test/vectors.json) against this build's encoding,
 * hashing and signing. Phones run it on the self-test screen and the backend runs it once at
 * start-up: if any line fails, that runtime would refuse valid payments.
 */
import { hbarToTinybar } from './amount';
import { canon } from './canonical';
import { hash, pubFromPriv, sign, signingHash, verifierIdFromPub, verifySig } from './crypto';

export interface VectorKey {
  label: string;
  priv: string;
  pub: string;
  verifierId: string;
}

export interface CanonVector {
  name: string;
  value: unknown;
  canon: string;
  hash: string;
}

export interface SignatureVector {
  name: string;
  /** Label of the key in `keys` that signed. */
  signer: string;
  /** The signed object, including its sig/sigs (signatures never cover themselves). */
  object: Record<string, unknown>;
  signingHash: string;
  sig: string;
}

export interface HbarVector {
  hbar: string;
  tinybar: string;
}

export interface VectorFile {
  version: 'dzp.vectors.v1';
  note: string;
  keys: VectorKey[];
  canon: CanonVector[];
  signatures: SignatureVector[];
  hbar: HbarVector[];
}

export interface VectorResult {
  name: string;
  ok: boolean;
  detail?: string;
}

function check(name: string, fn: () => string | true): VectorResult {
  try {
    const r = fn();
    return r === true ? { name, ok: true } : { name, ok: false, detail: r };
  } catch (e) {
    return { name, ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

export function checkVectors(file: VectorFile): VectorResult[] {
  const results: VectorResult[] = [];
  const keys = new Map(file.keys.map((k) => [k.label, k]));

  for (const k of file.keys) {
    results.push(
      check(`key ${k.label}`, () => {
        if (pubFromPriv(k.priv) !== k.pub) return 'pub mismatch';
        if (verifierIdFromPub(k.pub) !== k.verifierId) return 'verifierId mismatch';
        return true;
      }),
    );
  }

  for (const v of file.canon) {
    results.push(
      check(`canon ${v.name}`, () => {
        if (canon(v.value) !== v.canon) return 'canonical string mismatch';
        if (hash(v.value) !== v.hash) return 'hash mismatch';
        return true;
      }),
    );
  }

  for (const v of file.signatures) {
    results.push(
      check(`sig ${v.name}`, () => {
        const key = keys.get(v.signer);
        if (!key) return `unknown signer ${v.signer}`;
        if (signingHash(v.object) !== v.signingHash) return 'signing hash mismatch';
        if (sign(key.priv, v.object) !== v.sig) return 'signature mismatch';
        if (!verifySig(key.pub, v.object, v.sig)) return 'signature does not verify';
        if (verifySig(key.pub, { ...v.object, tampered: 1 }, v.sig)) return 'tampered object verifies';
        return true;
      }),
    );
  }

  for (const v of file.hbar) {
    results.push(
      check(`hbar ${v.hbar}`, () => (hbarToTinybar(v.hbar).toString() === v.tinybar ? true : 'tinybar mismatch')),
    );
  }

  return results;
}
