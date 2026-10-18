## Context

`validIncluded` in `packages/plugin/src/main.ts` is the only scope gate: it drops the conflict-review folder and paths that `normalizePath` rejects (any part starting with `.`). The engine in `markdown-sync.ts` trusts the vault adapter's lists and events, and `applyRemote` writes every live remote record. NATS permissions are per bucket, so there is no server-side key filter, and the invariants forbid a custom sync API.

## Decisions

1. **Filtering is client-side and per device.** The server keeps every record. Rules live in `data.json` (not secrets). Rejected: a rules file synced through the vault, because one bad rule on one device would silently reshape every device.
2. **New pure module `sync-scope.ts`** with `compileScope(settings)` returning `isInScope(path)`, reused by the adapter and the engine. Rejected: extending `normalizePath`, which is a protocol-level validity check shared with the CLI.
3. **Gitignore subset:** `#` comments, blank lines, `*`, `**`, `?`, leading `/` anchor, trailing `/` directory-only, `!` negation, last match wins, and a directory match covers everything beneath it (no re-include inside an excluded directory). Matching is case-insensitive to agree with path ownership. Rejected: full gitignore (character classes, escapes) as not worth its code.
4. **Evaluation order:** conflict-review folder and dot-part paths stay always out. Then the built-in junk list, if enabled, excludes any path with a matching part. Then user lines: Exclude mode syncs a path unless the final match excludes it; Only selected syncs it only if the final match includes it. In Only selected, `!pattern` carves out. Rejected: letting user lines override the junk list; the toggle is the escape.
5. **Engine gate.** The engine receives `isInScope` in `MarkdownSyncOptions`. Out-of-scope local events and scan entries are ignored. A rename is treated as a delete of the old path if only the old path was in scope, a create if only the new one is, and ignored if neither.
6. **Out-of-scope is not deletion.** Remote apply skips out-of-scope live records, leaving the index entry and KV untouched. A tombstone, rename or path release is never published because of scope, so a rule edit cannot delete data. Rejected: tombstoning on exclusion.
7. **Held outbox.** Queued operations for out-of-scope paths keep their stored content and are skipped by replay; held is derived from the current scope, not stored, so it survives restarts and releases when the rule changes. `SyncStatus.held` counts them. Rejected: dropping them (breaks "pending content stays") and a persisted flag (a second source of truth).

## Risks

- A broad rule hides files the user expects synced → live preview with match counts; Settings lists the held count.
- Only selected with an empty list syncs nothing → warning, and the previous mode is one tap away.
- A remote path newly in scope later downloads in bulk → reconcile applies it through the normal idempotent path.
- Devices with different rules diverge → documented as per-device.

## Migration

New settings default to Exclude with the junk list on and no user lines. Existing synced files that match the junk list stay in KV and locally; they simply stop syncing.
