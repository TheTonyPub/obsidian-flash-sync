## Execution notes

- Read `proposal.md`, `design.md`, both spec deltas, then `validIncluded` and `ObsidianMarkdownVault` in `packages/plugin/src/main.ts`, `applyRemote`, `reconcileOnce`, `rename`, `remove`, `replayPending` in `markdown-sync.ts`, and `packages/plugin/src/settings/{model,tab}.ts`.
- Base branch `origin/dev`. Plugin-only and local-only: no release, tag, host or real-vault actions. Use fixtures with no secrets.
- One owner carries tests, code and docs. Record RED before behavior code and GREEN afterward.
- Evidence: `npm run test:unit`, `npm run typecheck`, `npm run lint`, `npm run build:plugin`.

## 1. Matcher

- [x] 1.1 Add `packages/plugin/src/sync-scope.ts`: `compileScope({ mode, patterns, skipJunk })` returning `isInScope(path)`, plus `previewScope(paths)`. Done when: `tests/unit/sync-scope.test.ts` covers every scenario in `specs/sync-scope`, anchors, `**`, negation, directory cover, case-insensitivity and the always-out paths.

## 2. Settings model

- [x] 2.1 Add `scopeMode`, `scopePatterns`, `skipJunk` to `EasySyncSettings` with defaults (Exclude, empty, true) and load-time sanitizing. Done when: a test loads old `data.json` and gets defaults, and invalid values fall back.

## 3. Engine

- [x] 3.1 Pass `isInScope` through `MarkdownSyncOptions`; gate `validIncluded` call sites, scan lists and events, and apply the rename-boundary rules. Depends on 1.1. Done when: engine tests cover out-of-scope create, modify, delete, rename in, rename out, and no tombstone on exclusion.
- [x] 3.2 Skip out-of-scope live records in `applyRemote` and reconcile, leaving index and KV untouched. Done when: tests cover a remote out-of-scope record and re-entry to scope.
- [x] 3.3 Derive held operations from the scope (no stored flag); skip them in replay; expose `SyncStatus.held`. Done when: tests cover hold, resume, and restart persistence, and status stays unconverged while in-scope work is held.
- [x] 3.4 Re-apply scope live when settings save: rebuild the matcher, release or hold operations, trigger reconcile. Depends on 3.1 to 3.3. Done when: a test changes rules mid-session without restart.

## 4. Settings UI

- [x] 4.1 Add the Sync scope group to Advanced in `settings/tab.ts` with live preview, empty-list warning and the held-count line in Sync, using theme variables only. Done when: `tests/unit/settings-ui.test.ts` covers the scenarios in `specs/settings-ui`.
- [x] 4.2 Add the group to `docs/design/settings-ui/design-qa.md` and mark its captures pending. Done when: the note lists the pending captures.

## 5. Docs

- [x] 5.1 Document the syntax, built-in list, per-device behavior and exclusion semantics in `README.md`. Done when: the section links from the Advanced description.

## 6. Verification

- [x] 6.1 Run `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run build:plugin` and `openspec validate sync-scope-rules --strict`. Done when: all pass, summarized in the PR.

## 7. Owner acceptance (deferrable)

- [ ] 7.1 In a disposable vault with a visible `venv/` and a synced folder, check exclusion, Only selected, and re-entry on desktop and one phone. Done when: results are recorded in the PR.
