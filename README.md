# DeadZonePay

Offline HBAR payments for markets with no network. Four Android phones form their own mesh over Google Nearby Connections (Bluetooth + Wi-Fi Direct, no router, no internet). Every phone acks every payment, and a payment is approved once 3 of 4 phones ack it. The receiver can spend the money straight away. A double spend is refused. Back online, a backend settles on Hedera testnet and pays whoever holds the money last.

> Work in progress. This README grows phase by phase. The full protocol, fault model and test results land before submission.

## Repository layout

| Path | Owner | What |
| --- | --- | --- |
| `packages/protocol/` | P2 | Pure TypeScript payment rules: canonical encoding, signatures, notes, verifier, approvals, close, settlement plan |
| `packages/protocol/harness/` | P2 | Simulator, attackers, invariants, fuzzer and mutation tests that attack the protocol |
| `apps/backend/` | P1 | Express + Hedera SDK: threshold reserve, certificates, World ID, settlement |
| `apps/mobile/` | P3 (`src/core/` is P2) | Expo app: screens, mesh, on-phone verifier and wallet |
| `docs/contracts.md` | P2 | Frozen data formats and messages shared by every part |
| `docs/requests.md` | P2 | Changes P2 needs from P1 or P3 |

## Run the protocol tests

```bash
cd packages/protocol
npm install
npm test           # unit tests
npm run typecheck  # tsc --noEmit
npm run vectors    # regenerate test/vectors.json (must produce no diff)
```

## AI usage

This project is built with Claude Code. The main agent writes the protocol code. An Opus "critic" subagent reviews every phase for safety bugs before it is committed, and Haiku helper agents run the tests, check code against the contracts and look up library APIs. Commits where AI did notable work say so in an `AI usage:` paragraph. This section will list the details per component before submission.
