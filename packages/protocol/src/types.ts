/**
 * DeadZonePay shared data formats. docs/contracts.md mirrors this file field for field.
 * Frozen at the end of phase A. After that, changes are additive only; removing or
 * renaming a field bumps the version string (e.g. dzp.spend.v2).
 */

// ---------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------

/** Whole tinybars as a decimal string, positive, no sign, no leading zeros. "500000000" = 5 HBAR. */
export type Tinybar = string;
/** Compressed SEC1 P-256 public key, 66 lowercase hex chars (02/03 prefix). */
export type PubKey = string;
/** Compact ECDSA P-256 signature r||s, 128 lowercase hex chars, low-S. */
export type Sig = string;
/** SHA-256 of the canonical JSON of an object, 64 lowercase hex chars. */
export type Hash = string;
/** hash({type:'VERIFIER_ID', pub}).slice(0, 16). Derived from the key, never chosen. */
export type VerifierId = string;
/** Hedera account in shard.realm.num form, e.g. "0.0.4821337". */
export type HederaAccount = string;
/** Unix time in whole seconds. */
export type UnixSeconds = number;

// ---------------------------------------------------------------------------
// Version and type tags (every signed object carries one: domain separation)
// ---------------------------------------------------------------------------

export const VERSION = {
  ROSTER: 'dzp.roster.v1',
  RESERVE: 'dzp.reserve.v1',
  SPEND: 'dzp.spend.v1',
} as const;

export const TYPE = {
  GENESIS: 'GENESIS',
  NOTE: 'NOTE',
  VERIFIER_ID: 'VERIFIER_ID',
  VOTE: 'VOTE',
  REFUSE: 'REFUSE',
  HELLO: 'HELLO',
  INVOICE: 'INVOICE',
  CLOSE_REQUEST: 'CLOSE_REQUEST',
  CLOSED: 'CLOSED',
  SETTLEMENT_PLAN: 'SETTLEMENT_PLAN',
} as const;

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const LIMITS = {
  /** A spend consumes 1..4 notes. */
  MAX_INPUTS: 4,
  /** A spend creates 1..2 notes: receiver, then optional change. */
  MAX_OUTPUTS: 2,
  /** Spend and invoice memo, in UTF-16 code units. */
  MAX_MEMO: 140,
  /** Largest amount anywhere: Hedera tinybar values are signed 64-bit. */
  MAX_TINYBAR: 9_223_372_036_854_775_807n,
  /** Mesh: a message is forwarded at most once more after the first hop. */
  MESH_TTL: 2,
  /** Mesh: serialized envelope must stay under the Nearby Connections bytes payload limit. */
  MAX_MESSAGE_BYTES: 32 * 1024,
  /** Mesh: number of recent msgIds each phone remembers for dedupe. */
  DEDUPE_WINDOW: 1000,
  /** Mesh: STATUS heartbeat period. */
  STATUS_PERIOD_SECONDS: 3,
} as const;

// ---------------------------------------------------------------------------
// Online-issued objects (signed by settler + cosigner)
// ---------------------------------------------------------------------------

export interface RosterVerifier {
  id: VerifierId;
  pub: PubKey;
}

export interface Participant {
  pub: PubKey;
  name: string;
  hederaAccount: HederaAccount;
}

/** Who verifies and who may receive notes. Both sigs cover the roster without `sigs`. */
export interface Roster {
  version: typeof VERSION.ROSTER;
  marketId: string;
  epoch: number;
  /** Acks needed to approve. 3 for 4 phones; must satisfy 2*threshold - verifiers.length >= 2. */
  threshold: number;
  /** The phones that ack payments (4 in the demo). */
  verifiers: RosterVerifier[];
  /** Everyone who may own a note (the 4 phones in the demo). */
  participants: Participant[];
  sigs: { settler: Sig; cosigner: Sig };
}

/** Proof that a reserve account holds `amount` for `ownerPub`. Both sigs cover the certificate without `sigs`. */
export interface ReserveCertificate {
  version: typeof VERSION.RESERVE;
  reserveId: string;
  /** The threshold-key reserve account on Hedera. */
  hederaAccount: HederaAccount;
  amount: Tinybar;
  ownerPub: PubKey;
  marketId: string;
  /** hash(roster without sigs). */
  rosterHash: Hash;
  issuedAt: UnixSeconds;
  expiresAt: UnixSeconds;
  sigs: { settler: Sig; cosigner: Sig };
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * A piece of money.
 * First note of a reserve: noteId = hash({type:'GENESIS', certHash}), owner = cert.ownerPub, amount = cert.amount.
 * Output i of a spend:      noteId = hash({type:'NOTE', spendHash, index: i}).
 */
export interface Note {
  noteId: Hash;
  reserveId: string;
  owner: PubKey;
  amount: Tinybar;
}

export interface SpendOutput {
  owner: PubKey;
  amount: Tinybar;
}

/**
 * A payment. Signed by the owner of its input notes (there is no `from` field: the
 * owner comes from the notes). spendHash = hash(spend without sig).
 */
export interface Spend {
  version: typeof VERSION.SPEND;
  reserveId: string;
  marketId: string;
  /** 1..4 distinct noteIds, all owned by the signer, all from reserveId. */
  inputs: Hash[];
  /** 1..2 outputs: receiver first, then optional change back to the signer. */
  outputs: SpendOutput[];
  memo: string;
  createdAt: UnixSeconds;
  sig: Sig;
}

/** Why an input note exists: it is the reserve's first note, or an output of an approved spend. */
export type InputProof =
  | { kind: 'genesis'; cert: ReserveCertificate }
  | { kind: 'approval'; approval: Approval };

// ---------------------------------------------------------------------------
// Acks and approvals
// ---------------------------------------------------------------------------

/** One phone's signed ack of a spend. */
export interface Vote {
  type: typeof TYPE.VOTE;
  spendHash: Hash;
  marketId: string;
  epoch: number;
  verifierId: VerifierId;
  sig: Sig;
}

/** A spend plus votes from at least roster.threshold distinct roster verifiers. */
export interface Approval {
  spend: Spend;
  votes: Vote[];
}

// ---------------------------------------------------------------------------
// Close and settlement (online, after the market)
// ---------------------------------------------------------------------------

/** Published by the backend to stop a reserve. Signed by the settler. */
export interface CloseRequest {
  type: typeof TYPE.CLOSE_REQUEST;
  reserveId: string;
  marketId: string;
  requestedAt: UnixSeconds;
  sig: Sig;
}

export interface Lock {
  noteId: Hash;
  spendHash: Hash;
}

/** A phone's signed list of every lock it holds for one reserve. After signing it, the phone never acks that reserve again. */
export interface CloseAttestation {
  type: typeof TYPE.CLOSED;
  reserveId: string;
  verifierId: VerifierId;
  locks: Lock[];
  /** The full spends the locks point to, so the backend can check the owner's signature. */
  spends: Spend[];
  sig: Sig;
}

export interface Payout {
  hederaAccount: HederaAccount;
  amount: Tinybar;
}

export interface HeldNote {
  noteId: Hash;
  amount: Tinybar;
}

/**
 * Who gets paid from a reserve. payouts sorted by hederaAccount, held sorted by noteId.
 * sum(payouts) + sum(held) == cert.amount.
 * planHash = hash({type:'SETTLEMENT_PLAN', reserveId, payouts, held}).
 */
export interface SettlementPlan {
  reserveId: string;
  payouts: Payout[];
  held: HeldNote[];
  planHash: Hash;
}

// ---------------------------------------------------------------------------
// Mesh messages (phone to phone over Nearby Connections, JSON text)
// ---------------------------------------------------------------------------

/** Signed by the phone on connect. Peers disconnect a phone whose pub is not a roster verifier. */
export interface Hello {
  type: typeof TYPE.HELLO;
  verifierId: VerifierId;
  pub: PubKey;
  name: string;
  ts: UnixSeconds;
  sig: Sig;
}

/** A payment request. Signed by the receiver (`to`), so nobody can redirect a payment. */
export interface Invoice {
  type: typeof TYPE.INVOICE;
  to: PubKey;
  amount: Tinybar;
  memo: string;
  createdAt: UnixSeconds;
  sig: Sig;
}

/** Sent by the payer to every phone. proofs[i] proves spend.inputs[i]. */
export interface VerifyRequest {
  spend: Spend;
  proofs: InputProof[];
  /** The reserve certificate. Always included: spends of non-genesis notes need it for rule 1. */
  cert: ReserveCertificate;
}

/** A phone's signed refusal, with one of REASONS. */
export interface Refuse {
  type: typeof TYPE.REFUSE;
  spendHash: Hash;
  verifierId: VerifierId;
  reason: string;
  sig: Sig;
}

/** Heartbeat every LIMITS.STATUS_PERIOD_SECONDS; drives the "4 of 4 connected" badge. Not signed. */
export interface Status {
  verifierId: VerifierId;
  peers: VerifierId[];
  ts: UnixSeconds;
}

export interface MeshBodies {
  HELLO: Hello;
  INVOICE: Invoice;
  VERIFY_REQUEST: VerifyRequest;
  VOTE: Vote;
  REFUSE: Refuse;
  APPROVED: Approval;
  STATUS: Status;
}

export type MeshType = keyof MeshBodies;

export const MESH_TYPES: readonly MeshType[] = [
  'HELLO',
  'INVOICE',
  'VERIFY_REQUEST',
  'VOTE',
  'REFUSE',
  'APPROVED',
  'STATUS',
] as const;

/**
 * Every mesh message. Sent to all connected peers. A phone that sees an unseen msgId with
 * ttl > 1 forwards it once with ttl - 1. The envelope itself is not signed: anything that
 * moves money is signed inside the body.
 */
export interface Envelope<K extends MeshType = MeshType> {
  /** 32 lowercase hex chars (16 random bytes). */
  msgId: string;
  /** Sender's verifierId (the forwarder keeps the original sender). */
  from: VerifierId;
  type: K;
  body: MeshBodies[K];
  ttl: number;
}

// ---------------------------------------------------------------------------
// Refusal reasons (the exact strings shown on the verifier panel)
// ---------------------------------------------------------------------------

export const REASONS = {
  MALFORMED: 'malformed request',
  WRONG_VERSION: 'unsupported version',
  WRONG_MARKET: 'wrong market',
  CERT_BAD_SIG: 'certificate not signed by settler and cosigner',
  CERT_WRONG_ROSTER: 'certificate is for a different roster',
  CERT_EXPIRED: 'certificate expired',
  RESERVE_CLOSED: 'reserve closed',
  WRONG_RESERVE: 'note from a different reserve',
  UNKNOWN_NOTE: 'unknown note',
  BAD_APPROVAL: 'invalid approval proof',
  MIXED_OWNERS: 'inputs have different owners',
  BAD_SIGNATURE: 'bad signature',
  BAD_AMOUNT: 'amount must be a positive whole number of tinybars',
  UNBALANCED: 'inputs do not equal outputs',
  INPUT_COUNT: 'a payment spends 1 to 4 notes',
  OUTPUT_COUNT: 'a payment has 1 or 2 outputs',
  DUPLICATE_INPUT: 'same note used twice',
  RECEIVER_NOT_REGISTERED: 'receiver not registered',
  MEMO_TOO_LONG: 'memo too long',
  ALREADY_SPENT: 'note already spent',
} as const;

export type Reason = (typeof REASONS)[keyof typeof REASONS];
