import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkVectors, type VectorFile } from '../src/selftest';
import { TYPE, VERSION } from '../src/types';
import { buildVectors } from './vector-builder';

const committed = JSON.parse(
  readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'),
) as VectorFile;

describe('test vectors', () => {
  it('the committed vectors.json is exactly what the builder produces (run `npm run vectors`)', () => {
    expect(buildVectors()).toEqual(committed);
  });

  it('every vector passes checkVectors (what phones and the backend run)', () => {
    const failed = checkVectors(committed).filter((r) => !r.ok);
    expect(failed).toEqual([]);
  });

  it('checkVectors catches a corrupted hash, signature and key', () => {
    const bad = structuredClone(committed);
    bad.canon[0]!.hash = '0'.repeat(64);
    bad.signatures[4]!.sig = bad.signatures[5]!.sig;
    bad.keys[2]!.verifierId = 'ffffffffffffffff';
    const failed = checkVectors(bad).filter((r) => !r.ok).map((r) => r.name);
    expect(failed).toEqual(
      expect.arrayContaining([`canon ${bad.canon[0]!.name}`, `sig ${bad.signatures[4]!.name}`, `key ${bad.keys[2]!.label}`]),
    );
  });

  it('covers every signed message type', () => {
    const tags = new Set(
      committed.signatures.map((s) => String(s.object.version ?? s.object.type)),
    );
    for (const tag of [
      VERSION.ROSTER,
      VERSION.RESERVE,
      VERSION.SPEND,
      TYPE.VOTE,
      TYPE.INVOICE,
      TYPE.HELLO,
      TYPE.REFUSE,
      TYPE.CLOSE_REQUEST,
      TYPE.CLOSED,
    ]) {
      expect(tags).toContain(tag);
    }
  });
});
