> Approved: 2026-10-18 by the owner.

## Why

Obsidian does not hide visible folders such as `venv`, `node_modules` or `__pycache__`, so a vault that also holds code uploads thousands of junk files. Today only dot-path parts and the conflict-review folder are skipped. The user needs a .gitignore-style way to say what to skip, or to sync only chosen folders and file types.

## What Changes

- Add a per-device scope setting: a gitignore-style pattern list plus a mode, Exclude (default) or Only selected.
- Add a built-in skip list for common junk (`venv`, `.venv`, `node_modules`, `__pycache__`, `.git`, `.DS_Store`, `*.pyc` and similar), on by default, with a toggle.
- Apply the scope to local capture, rename, delete, startup scans and remote apply. Files that become out of scope stay untouched locally and remotely, with no tombstone.
- Keep queued outbox work for newly out-of-scope paths held, not dropped, and show the held count in Sync.
- Add a Sync scope group to Settings > Advanced with a pattern editor, a live match preview and a warning for an empty Only selected list.

Non-goals: server-side filtering (NATS KV has no key filter and no custom API is allowed), bulk removal of already uploaded remote files, syncing the scope between devices, `fos` changes.

## Impact

- Code: new `packages/plugin/src/sync-scope.ts`; `main.ts` (`validIncluded`, settings), `markdown-sync.ts` (scope gate, held outbox), `settings/model.ts`, `settings/tab.ts`, `connection.ts` (held count).
- Tests: new `tests/unit/sync-scope.test.ts`; additions to engine and settings tests.
- Specs: new `sync-scope`; modified `settings-ui` (ADDED requirement).
- Design: `docs/design/settings-ui/design-qa.md`, captures marked pending.
