## Context

`EasySyncSettingTab` in `packages/plugin/src/main.ts` renders five `SettingsSection` values with per-section drafts, `DraftSwitchModal`, `renderConflicts`, and the `ExportConfigModal`/`ImportConfigModal` flows. Status text comes from `status-presentation.ts`; styles live in `packages/plugin/styles.css`. `tests/unit/settings-ui.test.ts` covers drafts, conflicts, transfer and Advanced commits. Visual reference: `docs/design/settings-ui/design-qa.md`.

## Decisions

1. **Three sections.** `SettingsSection` becomes `sync | server | advanced`. Connection and Attachments merge into Server; Device transfer becomes Sync actions. Rejected: keeping five tabs with new copy, which still needs a mobile picker and keeps export two steps deep.
2. **One Server draft.** Drafts key on `server`, and `isDirty` merges the current connection and attachment field lists. `applyDraft(draft, "server")` validates both via `validateSettingsDraft` and reconnects once. The changed-field count comes from the same lists. Rejected: one draft per group, which means two save bars and partial reconnects.
3. **Settings module.** Move the tab, section renderers and transfer modals to `packages/plugin/src/settings/` (`tab.ts`, `sync-section.ts`, `server-section.ts`, `advanced-section.ts`, `transfer-modals.ts`). They receive a narrow plugin facade (status, config, apply, conflicts, transfer). Rejected: growing the 1,374-line `main.ts`.
4. **Theme variables only.** Styles use Obsidian core variables, Setting rows and `mod-cta`. Mobile rules key on `body.is-mobile` plus a narrow-container query. Rejected: the mockup hex palette, which breaks community and dark themes.
5. **Conflict labels map to existing actions.** Keep server version → `keepRemote`, Keep my version → `keepLocalCopy`, Compare side by side → `createConflictReview`, Mark resolved → `markConflictResolved`. The existing confirmation modals stay. Rejected: new resolution semantics.
6. **Generated phrase.** `generateTransferPhrase()` in `config-transfer.ts` returns four hyphenated groups of four characters from a 32-symbol alphabet without ambiguous characters, using `crypto.getRandomValues` (80 bits). PBKDF2 and the payload stay unchanged; users may replace the phrase. Rejected: a word list, which adds bundle size and less entropy per character.
7. **Last reconcile time.** `SyncStatus.lastReconciledAt` is set when reconciliation completes with no pending work. It is display-only and never used for ordering. Rejected: no timestamp, which leaves stale states indistinguishable.
8. **Status report.** `buildStatusReport(status, config)` in `diagnostics.ts` uses `errorSummary` redaction and `safeDiagnostic`. It emits states, counts, plugin version and the last errors, never secrets or payloads. Rejected: copying console logs.
9. **Share on mobile.** Feature-detect `navigator.share`; otherwise show only Copy link.

## Risks / Trade-offs

- [Tests assert old tabs and labels] → rewrite affected cases from the new scenarios first (RED), keeping draft, conflict and transfer behavior assertions.
- [The merged draft validates S3 fields while attachments are off] → keep the `attachmentsEnabled` gate and test both states.
- [Community themes override variables] → use core variables only; check the default light and dark themes.
- [`navigator.share` is missing in Obsidian mobile webviews] → feature detection with a Copy link fallback.
- [The module move hides regressions] → move without behavior change first, then change the sections.

## Migration

No persisted data changes: `statusBarMode`, drafts and secrets keep their keys. An open tab defaults to Sync after update.
