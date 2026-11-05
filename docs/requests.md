# Requests from P2

Changes P2 needs in files P2 does not own. Each item names the owner, what is needed, and why. The owner ticks it off when done.

## For P3 (apps/mobile, outside src/core)

- [ ] **Expo SDK 55.** `expo-nearby-connections@1.1.x` supports Expo 55 / React Native 0.83 only, and needs the New Architecture (on by default). Version 1.0.0 targets Expo 51.
- [ ] **Native dependencies, all in the first development build:**
  - `expo-nearby-connections` **and its peer `react-native-nitro-modules`** (the README install line: `npx expo install expo-nearby-connections react-native-nitro-modules`)
  - `expo-sqlite`, `expo-secure-store`, `react-native-webview`
  - `react-native-get-random-values`, imported first in `app/_layout.tsx` (key generation needs `crypto.getRandomValues`)
- [ ] **Protocol dependency:** `"@dzp/protocol": "file:../../packages/protocol"`, plus the same pins the protocol uses: `"@noble/curves": "1.9.7"`, `"@noble/hashes": "1.8.0"`. The protocol pins noble v1 because v2 is ESM-only and changes signing defaults.
- [ ] **`metro.config.js`:** `watchFolders: [path.resolve(__dirname, '../../packages/protocol')]` and `resolver.nodeModulesPaths: [path.resolve(__dirname, 'node_modules')]`, so files under `packages/protocol` resolve `@noble/*` from the app. If Metro still cannot resolve `@dzp/protocol` by hour 3, P2 adds a `sync-protocol` script that copies the package into `src/core/protocol/` (git-ignored).
- [ ] **Android runtime permissions** before the mesh starts (React Native's built-in `PermissionsAndroid` is enough): `BLUETOOTH_SCAN`, `BLUETOOTH_ADVERTISE`, `BLUETOOTH_CONNECT`, `NEARBY_WIFI_DEVICES`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`. `expo-nearby-connections` does not request them itself.
- [ ] Mesh messages are JSON **text** (`sendText`), each under 32 KB. Nothing needed from P3 here.

## For P1 (apps/backend)

- [ ] **Use the protocol package; don't re-implement it.** Add `"@dzp/protocol": "file:../../packages/protocol"` and run the backend and cosigner under `tsx` (the package ships TypeScript source, no build step). Use its `canon`, `hash`, `sign`, `verifySig` for the roster, certificate and close request, and (phase D) `settlementPlan` for both settler and cosigner. A one-byte encoding difference makes every phone refuse every payment.
- [ ] **Check against `packages/protocol/test/vectors.json`** once, from the backend: same keys must give the same pubs, hashes and signatures.
- [ ] **`GET /roster` also returns `settlerPub` and `cosignerPub`** (compressed P-256 hex). Phones need them to verify the roster and certificates offline.
- [ ] **Roster verifier ids are derived:** `id = hash({type:'VERIFIER_ID', pub}).slice(0, 16)`. Phones reject a roster whose ids don't match. Use `verifierIdFromPub(pub)` from the package.
- [ ] **Threshold rule:** phones accept a roster only if `2 * threshold - verifiers.length >= 2`. That gives 3 of 4, or 3 of 3 as the fallback; 2 of 4 is rejected.
- [ ] **Close request shape** (signed by the settler key): `{ type: 'CLOSE_REQUEST', reserveId, marketId, certHash, requestedAt, sig }`, served from `GET /closes`.
- [ ] **Never re-issue a certificate for an existing `reserveId`** (not even to extend `expiresAt`). Phones pin the first certificate per reserve and refuse any other; a longer validity means a new reserve.
- [ ] **A new roster for the same market must bump `epoch`.**
- [ ] **Cosigner signs only the Hedera scheduled transfer** (after recomputing `settlementPlan` and matching `planHash`), never an app-level plan object.
- [ ] **Signatures are over the hash of the object without its `sig` / `sigs` field.** Settler and cosigner both sign the same payload: the roster or certificate minus `sigs`.
