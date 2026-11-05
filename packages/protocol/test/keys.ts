/**
 * Deterministic test keys derived from a label, so vectors, tests and the harness are
 * reproducible. Test-only: real phones use privFromRandom with crypto.getRandomValues.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { privFromRandom, pubFromPriv, verifierIdFromPub, type Rand } from '../src/crypto';

/** A Rand that expands a seed string with SHA-256 in counter mode. */
export function seededRand(seed: string): Rand {
  let counter = 0;
  return (n: number) => {
    const out = new Uint8Array(n);
    let filled = 0;
    while (filled < n) {
      const block = sha256(utf8ToBytes(`${seed}:${counter++}`));
      const take = Math.min(block.length, n - filled);
      out.set(block.subarray(0, take), filled);
      filled += take;
    }
    return out;
  };
}

export interface TestKey {
  label: string;
  priv: string;
  pub: string;
  verifierId: string;
}

export function testKey(label: string): TestKey {
  const priv = privFromRandom(seededRand(`dzp-test-key:${label}`));
  const pub = pubFromPriv(priv);
  return { label, priv, pub, verifierId: verifierIdFromPub(pub) };
}
