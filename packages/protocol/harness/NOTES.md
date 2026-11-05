# Protocol and harness notes (P2)

A running log of decisions and open questions. The newest entries go at the bottom of each section.

## Decisions

- **noble v1, pinned.** `@noble/curves@1.9.7` and `@noble/hashes@1.8.0`. v2.x is ESM-only and hashes the message by default (`prehash`). We sign a 32-byte SHA-256 digest we computed ourselves, and v1's CJS+ESM build is the safer bet on Metro/Hermes.
- **No build step.** `@dzp/protocol` points `main` at `src/index.ts`. Metro, vitest and `tsx` all load TypeScript source. The backend must run under `tsx`.
- **Pure and synchronous.** No network, filesystem, clock or global randomness in `src/`. Time is a `now` argument and randomness is an injected `rand(n)` function. Everything is synchronous, so a phone can write its lock and sign its vote inside one SQLite transaction.
- **Signing payload = object minus top-level `sig` and `sigs`.** spendHash, certHash and rosterHash all exclude signatures. Re-encoding a signature can therefore never produce a "different" spend, which would let one payment get two sets of note ids.
- **Strict signature format.** Lowercase compact hex, 128 chars. High-S is rejected (noble produces low-S). The compact form is parsed explicitly, so there is no DER/compact ambiguity.
- **Derived verifier ids:** `hash({type:'VERIFIER_ID', pub}).slice(0,16)`. P1 doesn't need to coordinate them, and a roster can't map two ids to one key.
- **VERIFY_REQUEST carries the certificate.** A spend of a received note has only approval proofs, and rule 1 still needs the certificate. That adds about 0.7 KB, well under the 32 KB mesh limit.
- **INVOICE, REFUSE and HELLO are signed.** An unsigned invoice could swap the receiver's key and redirect a payment. A signed refusal lets the panel name the refusing phone truthfully.
- **No "not yet valid" check on certificates.** Only expiry is checked, by the phone's clock. A phone whose clock runs a few minutes behind must not refuse a fresh certificate, and safety doesn't depend on `issuedAt`.

- **Phase A review fixes (Opus critic, first verdict BLOCK, then PASS after fixes):**
  - The genesis proof carries no certificate. The first note comes only from the signed request cert; the old shape let a payer mint money from a forged cert (CRITICAL).
  - One certificate per reserveId, pinned in the same transaction as the locks (HIGH).
  - CloseRequest and CloseAttestation bind `marketId` and `certHash`, so an attestation can't be replayed from another market (HIGH).
  - Close is persist-before-reply.
  - A note is held only if the attestation includes an owner-signed spend.
  - Settlement checks for conflicting approvals across the whole uploaded set before applying any.
  - `canon` rejects unpaired surrogates, getters, non-enumerable properties and arrays with extras.
  - `checkVectors` fails on an incomplete file.
  - HELLO and INVOICE carry `marketId`; INVOICE carries `invoiceId`.
- **Carried into phase B:** validators must reject unknown or missing fields on every signed type (exact key sets). `canon` cannot catch that, because the signing payload ignores top-level `sig`/`sigs`.

## Open questions (for the phase A review with P1 and P3)

- `threshold` is typed `number` with the rule `2t - n >= 2`, not the literal `3`, so a 3-of-3 roster works if the fourth phone is missing. OK?
- Proposed for later phases (not in the frozen types yet):
  - A held note counts only if the attestation includes the owner-signed spend that locks it, so a lying verifier can't freeze other people's money.
  - `pay()` reports "refused" once refusals exceed `n - threshold`, so one lying phone can't kill a payment; every reason is still shown.
