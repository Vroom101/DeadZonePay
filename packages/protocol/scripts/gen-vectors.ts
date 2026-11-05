/** Regenerates test/vectors.json. Run: npm run vectors. The result must not differ from git. */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildVectors } from '../test/vector-builder';

const out = fileURLToPath(new URL('../test/vectors.json', import.meta.url));
writeFileSync(out, `${JSON.stringify(buildVectors(), null, 2)}\n`, 'utf8');
console.log(`wrote ${out}`);
