# Startup path evidence

## Confirmed from the current source

1. `EasySyncPlugin.onload()` awaits `loadData()`, fills defaults, and saves the resulting settings before registering lifecycle handlers (`packages/plugin/src/main.ts:198-216`).
2. `workspace.onLayoutReady` starts `connectNow()` (`main.ts:251`). Connection validation reads whether the configured password key has a value in SecretStorage, then `connectVault()` reads the actual secret before calling the WSS connector (`main.ts:439-445`, `connection.ts:109-139`).
3. The plugin creates `LocalStore` and the sync engine only after `connectVault()` resolves (`main.ts:479-512`). `engine.start()` performs initial reconciliation before the connection call completes.
4. A failed connection reaches the catch path, which disconnects partial state and reports `AUTH_ERROR` or `OFFLINE` (`main.ts:527-538`).
5. The `online` and visible `visibilitychange` handlers call `reconcileAfter()`. That method immediately returns if no engine exists (`main.ts:252-262`, `main.ts:400-401`).

## Not established by source inspection

- The report that users need to press **Connect** after startup is not reproduced against a running Obsidian desktop or mobile client in this investigation.
- The initial WSS failure's cause is unknown. Settings/SecretStorage readiness, endpoint availability, and platform lifecycle timing remain hypotheses until runtime logs or a reproducible client test identify one.

## Existing contract coverage

`tests/unit/reconciliation.test.ts` already verifies that a queued local mutation remains in the durable outbox and status stays unreconciled when snapshot and fallback discovery both fail. The new lifecycle tests cover the missing retry path from initial connection failure to a later connectivity/resume signal.
