> Approved: 2026-09-30 by the owner.

## Why

Settings spread status, conflicts, connection, attachments and transfer over five tabs, so checking state, resolving a conflict or moving settings to another device takes several steps. Mobile needs a separate section picker and long single-row fields. The approved design in `docs/design/settings-ui/` regroups the same functions around the next action.

## What Changes

- Replace Overview, Connection, Attachments, Device transfer and Advanced with **Sync**, **Server** and **Advanced**.
- Sync: status summary with contextual actions, conflicts with consequence-labelled choices, send/receive settings, status-bar mode (moved from Advanced).
- Server: one staged draft for connection and S3, saved-secret rows with Replace, and an unsaved-changes bar.
- Export: generated code phrase, Copy link, mobile share sheet; disabled while credentials fail.
- Advanced: device ID copy and a redacted status report next to existing controls.
- Theme-variable styling for light/dark and a one-column mobile layout.

Non-goals: sync engine, conflict semantics, transfer payload format, NATS/S3 setup, releases.

## Impact

- Code: `packages/plugin/src/main.ts` (settings tab and modals move to `packages/plugin/src/settings/`), `status-presentation.ts`, `connection.ts` (last reconcile time), `config-transfer.ts` (phrase generator), `diagnostics.ts` (status report), `packages/plugin/styles.css`.
- Tests: `tests/unit/settings-ui.test.ts`, `config-transfer.test.ts`, `diagnostics.test.ts`.
- Specs: new `settings-ui`; modified `sync-status-presentation`. Conflict actions keep `conflict-resolution` semantics under new labels.
- Docs: `docs/iphone-setup.md` if it names old tabs.
