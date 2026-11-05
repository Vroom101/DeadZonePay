# DeadZonePay contracts

**Status: phase A draft, for P1 + P3 review.** Once all three agree, this file is frozen. After that, changes are **additive only**: removing or renaming a field needs all three people and bumps the version string (`dzp.spend.v1` → `dzp.spend.v2`).

Source of truth in code: [`packages/protocol/src/types.ts`](../packages/protocol/src/types.ts). This document mirrors it field for field. Never re-implement encoding or signing: import `@dzp/protocol`. To prove a runtime matches byte for byte, run `checkVectors()` on [`packages/protocol/test/vectors.json`](../packages/protocol/test/vectors.json).

Section 10 lists the points that go beyond the master build plan and need a yes from P1 and P3.

---

## 1. Encoding

| What | Rule |
| --- | --- |
| Canonical JSON | Keys sorted by UTF-16 code unit (JavaScript's default sort) at every depth; no whitespace; arrays keep their order. Allowed values: plain objects, arrays, strings, **safe integers**, booleans, `null`. Floats, `NaN`, `undefined`, bigint, Dates and typed arrays are errors, never silently converted. Strings use `JSON.stringify` escaping. `canon()` |
| Hash | SHA-256 of the UTF-8 bytes of the canonical JSON, 64 lowercase hex chars. `hash()` |
| Signing payload | The object **minus its top-level `sig` and `sigs` fields**. `signingPayload()` |
| Signature | ECDSA P-256 over the 32-byte SHA-256 digest of the canonical signing payload (no second hash). RFC 6979 deterministic. **Low-S.** Compact `r‖s`, 128 lowercase hex chars. Verifiers reject high-S, DER, uppercase and wrong lengths. `sign()`, `verifySig()` |
| Private key | 32 bytes, 64 lowercase hex chars. Stays on the device (expo-secure-store) or in the backend's `.env`. |
| Public key | Compressed SEC1 P-256 point, 66 lowercase hex chars (`02…`/`03…`), and a valid point on the curve. |
| Domain separation | Every signed object carries a `version` or `type` tag (section 2), so a signature over one kind of message can never be replayed as another. |
| Amount (`Tinybar`) | Whole tinybars as a decimal string: positive, no sign, no leading zeros, at most 2⁶³−1 (Hedera's int64). `"300000000"` = 3 ℏ. bigint inside code, never a JS number. |
| Time | Unix seconds, integer. |
| Hedera account | `shard.realm.num`, e.g. `"0.0.4821337"` (the form `AccountId.fromString` accepts). |

Signatures and Hedera keys are separate: app messages use P-256; Hedera accounts use their own keys, and only the backend touches them.

## 2. Tags and derived identifiers

| Tag | Used by |
| --- | --- |
| `dzp.roster.v1` | `Roster.version` |
| `dzp.reserve.v1` | `ReserveCertificate.version` |
| `dzp.spend.v1` | `Spend.version` |
| `VOTE`, `REFUSE`, `HELLO`, `INVOICE`, `CLOSE_REQUEST`, `CLOSED` | `type` of those messages |
| `GENESIS`, `NOTE`, `VERIFIER_ID`, `SETTLEMENT_PLAN` | hash preimages below (never sent as messages) |

| Identifier | Definition |
| --- | --- |
| `rosterHash` | `hash(roster without sigs)` |
| `certHash` | `hash(certificate without sigs)` |
| `spendHash` | `hash(spend without sig)`. Never depends on signature bytes. |
| First note id | `hash({ type: 'GENESIS', certHash })` |
| Output note id | `hash({ type: 'NOTE', spendHash, index })`, where `index` is the output's position (0 = receiver, 1 = change) |
| `verifierId` | `hash({ type: 'VERIFIER_ID', pub }).slice(0, 16)`. Derived from the key, never chosen. `verifierIdFromPub()` |
| `planHash` | `hash({ type: 'SETTLEMENT_PLAN', reserveId, payouts, held })` |
| Mesh `msgId` | 16 random bytes, 32 lowercase hex chars |

## 3. Data formats

```ts
type Tinybar = string;        // "500000000" = 5 HBAR
type PubKey = string;         // compressed P-256, 66 hex
type Sig = string;            // compact r||s, 128 hex, low-S
type Hash = string;           // 64 hex
type VerifierId = string;     // 16 hex, derived from pub
type HederaAccount = string;  // "0.0.N"
type UnixSeconds = number;
```

### Roster: issued online, signed by settler + cosigner

```ts
interface RosterVerifier { id: VerifierId; pub: PubKey }
interface Participant { pub: PubKey; name: string; hederaAccount: HederaAccount }

interface Roster {
  version: 'dzp.roster.v1';
  marketId: string;
  epoch: number;
  threshold: number;               // 3 for 4 phones; must satisfy 2*threshold - verifiers.length >= 2
  verifiers: RosterVerifier[];     // the phones that ack (4 in the demo)
  participants: Participant[];     // who may own notes (the 4 phones in the demo)
  sigs: { settler: Sig; cosigner: Sig };   // both over the roster without sigs
}
```

A phone accepts a roster only if:
- both sigs verify against the pinned `settlerPub` and `cosignerPub`;
- `threshold` is an integer with `threshold <= verifiers.length` and `2*threshold - verifiers.length >= 2` (any two approving groups then share at least 2 phones, so at least one honest phone when at most one cheats);
- verifier ids and pubs are unique, and every `id == verifierIdFromPub(pub)`;
- participant pubs are unique, and every `hederaAccount` matches `shard.realm.num`.

### ReserveCertificate: signed by settler + cosigner

```ts
interface ReserveCertificate {
  version: 'dzp.reserve.v1';
  reserveId: string;
  hederaAccount: HederaAccount;  // the threshold-key reserve account
  amount: Tinybar;
  ownerPub: PubKey;              // owner of the first note
  marketId: string;
  rosterHash: Hash;              // hash(roster without sigs)
  issuedAt: UnixSeconds;
  expiresAt: UnixSeconds;
  sigs: { settler: Sig; cosigner: Sig };   // both over the certificate without sigs
}
```

### Money

```ts
interface Note { noteId: Hash; reserveId: string; owner: PubKey; amount: Tinybar }
// first note:   noteId = hash({type:'GENESIS', certHash}), owner = cert.ownerPub, amount = cert.amount
// output i:     noteId = hash({type:'NOTE', spendHash, index: i}), owner/amount = spend.outputs[i]

interface SpendOutput { owner: PubKey; amount: Tinybar }

interface Spend {                 // a payment, signed by the owner of its input notes
  version: 'dzp.spend.v1';
  reserveId: string;
  marketId: string;
  inputs: Hash[];                 // 1..4 distinct noteIds, same owner, same reserve
  outputs: SpendOutput[];         // 1..2: receiver first, then optional change
  memo: string;                   // at most 140 UTF-16 code units
  createdAt: UnixSeconds;
  sig: Sig;
}

type InputProof =
  | { kind: 'genesis' }                          // first note derived from the request's cert
  | { kind: 'approval'; approval: Approval };
```

- A `Spend` has no `from` field: the signer is the owner of its input notes, taken from the proofs.
- A genesis proof carries **no certificate of its own**. The first note is always derived from `VerifyRequest.cert`, the only certificate whose signatures rule 1 checks. A certificate inside the proof would let a payer mint money from an unsigned, forged certificate.
- **One certificate per reserve, ever.** The backend never re-issues or edits a certificate for an existing `reserveId`. A longer validity means a new reserve. Each phone pins the first `certHash` it accepts for each `reserveId` and refuses any other (`a different certificate for this reserve was seen first`). Two valid certificates for one reserve would give two first notes, so the reserve could be spent twice.
- **Exact fields.** Every signed object must have exactly the fields listed here; phase B validators reject unknown or missing fields. Signatures ignore top-level `sig`/`sigs`, so extra fields there would otherwise ride along unchecked.

### Acks and approvals

```ts
interface Vote {
  type: 'VOTE';
  spendHash: Hash;
  marketId: string;
  epoch: number;
  verifierId: VerifierId;
  sig: Sig;                       // by that verifier's pub
}

interface Approval { spend: Spend; votes: Vote[] }
```

An `Approval` is **valid** when at least `roster.threshold` of its votes come from **distinct** roster verifiers. Each such vote must:
- be `type: 'VOTE'`;
- have `spendHash == hash(spend without sig)`;
- carry the roster's `marketId` and `epoch`;
- have a sig that verifies against that verifier's roster pub.

Extra or invalid votes are ignored, never counted. The approval does not re-check the spend: at least 2 of the 3 voters are honest and already checked it.

### Close and settlement (online, after the market)

```ts
interface CloseRequest {          // published by the backend, signed by the settler
  type: 'CLOSE_REQUEST';
  reserveId: string;
  marketId: string;
  certHash: Hash;                 // signingHash of the reserve's certificate
  requestedAt: UnixSeconds;
  sig: Sig;
}

interface Lock { noteId: Hash; spendHash: Hash }

interface CloseAttestation {      // one phone's signed list of every lock it holds for one reserve
  type: 'CLOSED';
  reserveId: string;
  marketId: string;
  certHash: Hash;                 // signingHash of the reserve's certificate (no replay across markets or certificates)
  verifierId: VerifierId;
  locks: Lock[];
  spends: Spend[];                // the full spends the locks point to
  sig: Sig;
}

interface Payout { hederaAccount: HederaAccount; amount: Tinybar }
interface HeldNote { noteId: Hash; amount: Tinybar }

interface SettlementPlan {
  reserveId: string;
  payouts: Payout[];              // sorted by hederaAccount, one entry per account, no zero amounts
  held: HeldNote[];               // sorted by noteId
  planHash: Hash;                 // hash({type:'SETTLEMENT_PLAN', reserveId, payouts, held})
}
```

- A phone answers a `CloseRequest` only if its sig verifies against `settlerPub` and its `certHash` equals the phone's pinned certHash for that reserve; the attestation carries that same certHash.
- **Close is persist-before-reply.** In one transaction, the phone saves `closed = true` and the lock snapshot for the reserve. Only then does it sign and send its `CloseAttestation`. From then on it refuses every spend from that reserve (`reserve closed`), even after a crash and restart.
- `settlementPlan(cert, roster, approvals, attestations)` (phase D) needs attestations from at least `threshold` distinct verifiers. It works as follows:
  0. Ignore any attestation whose `marketId` or `certHash` doesn't match the certificate being settled, or whose signature or verifier is not in the roster.
  1. First, across **all** valid uploaded approvals for this reserve (deduplicated by spendHash), check that no two different spends share an input note. If any do, safety is broken: settlement stops and nobody signs. This check doesn't depend on order. Then start from the first note and apply an approval only when all its inputs are currently unspent notes of this reserve, repeating until nothing more applies (dependency order).
  2. Pay every unspent note to its owner's `hederaAccount`.
  3. **Hold** an unspent note only if some attestation shows it locked by a spend with no uploaded approval **and** includes that spend, owner-signed, with `signingHash == lock.spendHash` and the note among its inputs. A lying verifier cannot freeze someone else's money; only a double-signing owner can get their own note stuck.
- It always satisfies `sum(payouts) + sum(held) == cert.amount`.
- The cosigner recomputes the plan from the same uploads and signs the **Hedera scheduled transfer** (ScheduleSign) only if `planHash` matches. It signs no app-level plan object; `planHash` travels as the schedule memo.
- **Roster re-issue bumps `epoch`.** Votes bind `marketId` and `epoch`, so any new roster for the same market must use a new epoch.

## 4. Ack rules (every phone, in this order; the first failure is the refusal reason)

| # | Rule | Refusal reasons |
| --- | --- | --- |
| 0 | Well-formed: `version == 'dzp.spend.v1'`; `marketId` is this roster's; 1–4 distinct inputs with one proof each (`proofs[i]` proves `inputs[i]`); 1–2 outputs; memo ≤ 140 | `malformed request`, `unsupported version`, `wrong market`, `a payment spends 1 to 4 notes`, `same note used twice`, `a payment has 1 or 2 outputs`, `memo too long` |
| 1 | The certificate in the request is signed by settler and cosigner, is for this market and this roster, and is for `spend.reserveId`. Its `certHash` equals the one this phone pinned for that reserve, or none is pinned yet and this one gets pinned. It is not expired by **this phone's** clock (`now < expiresAt`), and the reserve is not closed on this phone. | `certificate not signed by settler and cosigner`, `wrong market`, `certificate is for a different roster`, `note from a different reserve`, `a different certificate for this reserve was seen first`, `certificate expired`, `reserve closed` |
| 2 | Every input note is real. A `genesis` proof: the input equals `hash({type:'GENESIS', certHash})` of **the request's `cert`**, and the note's owner and amount come from that cert. An `approval` proof is a valid approval (section 3) for a spend of the same reserve, and the input is one of its output note ids. | `unknown note`, `invalid approval proof`, `note from a different reserve` |
| 3 | All inputs have the same owner and the same reserve, and `spend.sig` verifies against that owner. | `inputs have different owners`, `note from a different reserve`, `bad signature` |
| 4 | Every amount is a valid `Tinybar`; sum of inputs == sum of outputs exactly; every output owner is a roster participant. | `amount must be a positive whole number of tinybars`, `inputs do not equal outputs`, `receiver not registered` |
| 5 | No input is locked to a **different** spendHash. If every input is unlocked or locked to this same spendHash, continue (a retry gets the same vote back). | `note already spent` |
| 6 | In **one transaction**: persist the certificate pin from rule 1 (if new) and lock every input to this spendHash. Only after it commits, sign and send the vote. The closed check and the pin check are repeated inside the same transaction. | `reserve closed`, `a different certificate for this reserve was seen first` |

A refusal is sent as a signed `REFUSE`. A vote is deterministic (RFC 6979), so a retried request returns the identical `VOTE`.

## 5. Mesh messages (phone to phone, Nearby Connections)

Transport: `expo-nearby-connections` with `Strategy.P2P_CLUSTER`. Every phone advertises **and** discovers, and the advertised name is its `verifierId`. Of two phones that find each other, only the one with the lower `verifierId` calls `requestConnection`, which avoids duplicate links. Messages are JSON **text** (`sendText`).

```ts
interface Envelope<K extends MeshType = MeshType> {
  msgId: string;      // 32 hex, random
  from: VerifierId;   // original sender (forwarders keep it)
  type: K;
  body: MeshBodies[K];
  ttl: number;        // starts at 2
}
```

Delivery rules:
- Send each message to every connected peer.
- Keep the last 1,000 `msgId`s. Drop any you have seen. If an unseen message has `ttl > 1`, forward it once with `ttl - 1`.
- The UTF-8 length of `JSON.stringify(envelope)` must be strictly less than 32,768 bytes (`LIMITS.MAX_MESSAGE_BYTES`).
- The envelope is **not** signed: everything that moves money is signed inside the body.
- A new connection may send only `HELLO` until it has sent a valid one: signed, this `marketId`, `pub` in `roster.verifiers`, `verifierId == verifierIdFromPub(pub)`. Otherwise disconnect. (A replayed HELLO can at most fake presence in the "connected" badge. It can't move money, because every vote and spend is signed.)
- The payer remembers each paid `invoiceId` and never pays the same invoice twice.

| Type | Sent by | Body | Signed by |
| --- | --- | --- | --- |
| `HELLO` | each phone, on connect | `Hello` | the phone |
| `INVOICE` | receiver; shows "Chai stall asks 3 ℏ, Pay?" on the payer | `Invoice` | the receiver (`to`) |
| `VERIFY_REQUEST` | payer, to everyone including itself | `VerifyRequest` | the spend inside is signed by the payer |
| `VOTE` | every phone that accepts | `Vote` | the voter |
| `REFUSE` | a phone that rejects | `Refuse` | the refuser |
| `APPROVED` | the first phone to see `threshold` valid votes, so phones that missed votes catch up | `Approval` | the votes inside |
| `STATUS` | each phone every 3 s; drives the "4 of 4 connected" badge | `Status` | not signed (display only) |

```ts
interface Hello { type: 'HELLO'; marketId: string; verifierId: VerifierId; pub: PubKey; name: string; ts: UnixSeconds; sig: Sig }
interface Invoice { type: 'INVOICE'; marketId: string; invoiceId: string; to: PubKey; amount: Tinybar; memo: string; createdAt: UnixSeconds; sig: Sig }
interface VerifyRequest { spend: Spend; proofs: InputProof[]; cert: ReserveCertificate }
interface Refuse { type: 'REFUSE'; spendHash: Hash; verifierId: VerifierId; reason: string; sig: Sig }
interface Status { verifierId: VerifierId; peers: VerifierId[]; ts: UnixSeconds }
// VOTE body = Vote, APPROVED body = Approval
```

Size check: a request spending 4 received notes carries 4 approvals (about 1.5 KB each) plus the certificate (about 0.7 KB). That is well under 32 KB.

## 6. Refusal reasons (exact strings, `REASONS` in code)

`malformed request` · `unsupported version` · `wrong market` · `certificate not signed by settler and cosigner` · `certificate is for a different roster` · `a different certificate for this reserve was seen first` · `certificate expired` · `reserve closed` · `note from a different reserve` · `unknown note` · `invalid approval proof` · `inputs have different owners` · `bad signature` · `amount must be a positive whole number of tinybars` · `inputs do not equal outputs` · `a payment spends 1 to 4 notes` · `a payment has 1 or 2 outputs` · `same note used twice` · `receiver not registered` · `memo too long` · `note already spent`

## 7. Limits (`LIMITS` in code)

| Limit | Value |
| --- | --- |
| Inputs per spend | 1–4 |
| Outputs per spend | 1–2 |
| Memo | 140 UTF-16 code units |
| Largest amount | 9,223,372,036,854,775,807 tinybars (int64) |
| Mesh ttl | 2 |
| Mesh message | under 32 KB |
| Dedupe window | last 1,000 msgIds |
| STATUS period | 3 s |

## 8. Keys at a glance

| Key | Where it lives | Signs |
| --- | --- | --- |
| Phone key (one per phone) | expo-secure-store, created on first launch | spends (as note owner), votes, refusals, HELLO, invoices, close attestations |
| Settler key | backend `.env` | roster, certificates, close requests |
| Cosigner key | cosigner process `.env` (separate process, port 4001) | roster, certificates |
| Hedera account keys | backend only | Hedera transactions, never app messages |

Phones get `settlerPub` and `cosignerPub` from `GET /roster` while online, and pin them for the market.

## 9. Checking that you match

`packages/protocol/test/vectors.json` holds six labelled **test-only** keys and one signed sample of every message type. Each sample has its canonical string, hash, signing hash and signature.

```ts
import { checkVectors } from '@dzp/protocol';
import vectors from '@dzp/protocol/test/vectors.json';   // or read the file
const failed = checkVectors(vectors).filter((r) => !r.ok); // must be []
```

Phones show this on the self-test screen. The backend should run it once at start-up.

## 10. Beyond the master plan: please confirm

These are additions or tightenings to the build plan's formats. All are already in `types.ts`.

1. **`VERIFY_REQUEST` carries `cert`.** The plan's body was "spend + one proof per input". A spend of a *received* note has only approval proofs, and rule 1 still needs the certificate.
2. **`INVOICE`, `REFUSE` and `HELLO` are signed.** An unsigned invoice could swap the receiver's key and redirect a payment. A signed refusal names the refusing phone truthfully on the verifier panel.
3. **`verifierId` is derived from the pub** (`hash({type:'VERIFIER_ID', pub}).slice(0,16)`). P1 doesn't choose ids, and phones reject a roster whose ids don't match.
4. **`threshold` is a `number` with the rule `2t − n ≥ 2`**, instead of the literal `3`. That gives 3 of 4, or 3 of 3 if only three phones are available; 2 of 4 is rejected.
5. **`CloseRequest` shape** (new): `{ type: 'CLOSE_REQUEST', reserveId, marketId, certHash, requestedAt, sig }`, signed by the settler. `CloseAttestation` also gains `marketId` and `certHash`, so an attestation can't be replayed from another market or certificate.
6. **No "not yet valid" check on certificates.** Only `expiresAt` is checked, so a phone whose clock runs a few minutes behind doesn't refuse a fresh certificate.
7. **Well-formedness is rule 0**, with its own reasons: version, market, input/output counts, duplicate inputs, memo length.
8. **Genesis proof carries no certificate** (`{ kind: 'genesis' }`). The plan had `{kind:'genesis'; cert}`, which allowed minting from a forged certificate (found by the phase A review).
9. **One certificate per reserveId, pinned by every phone.** P1 must never re-issue a certificate for an existing reserve.
10. **`HELLO` and `INVOICE` carry `marketId`; `INVOICE` carries `invoiceId`.**
11. **Strings with unpaired UTF-16 surrogates are rejected** by `canon()`, and so are getters and non-enumerable properties. Engines disagree on how to encode them.
