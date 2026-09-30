## Execution notes

- Read `proposal.md`, `design.md`, both spec deltas, `docs/design/settings-ui/design-qa.md` and its reference PNGs, then `EasySyncSettingTab`, `ExportConfigModal` and `ImportConfigModal` in `packages/plugin/src/main.ts`, plus `tests/unit/settings-ui.test.ts`.
- Base branch `origin/dev`. Plugin-only and local-only: no release, tag, host or real-vault actions.
- One owner carries tests, code and docs. For each behavior task, record the failing test (RED), then the passing test (GREEN).
- No secrets, transfer codes or phrases in tests, fixtures, logs or screenshots.
- Evidence: `npm run test:unit`, `npm run typecheck`, `npm run lint`, `npm run build:plugin`.

## 1. Structure

- [x] 1.1 Move the settings tab, section renderers and transfer modals from `packages/plugin/src/main.ts` into `packages/plugin/src/settings/` behind a narrow plugin facade, with no behavior change. Done when: the existing `tests/unit/settings-ui.test.ts` passes unchanged in intent (imports updated only), and `typecheck` and `build:plugin` pass.
- [x] 1.2 Replace the five sections with `sync | server | advanced`: desktop tabs with arrow/Home/End keys, a mobile segmented control with no picker, a Sync conflict count and a Server error marker. Depends on 1.1. Done when: tests for default section, order, keyboard navigation, badge and marker are RED then GREEN.

## 2. Sync section

- [x] 2.1 Add `lastReconciledAt` to `SyncStatus` in `packages/plugin/src/connection.ts`, set only when reconciliation completes with no pending work. Done when: a unit test shows it is set on completion, unchanged while work remains, and unused for ordering.
- [x] 2.2 Render the Sync summary: label, sentence, server / attachments / queue values, last reconcile time, Sync now, and the auth-error and unconfigured variants. The status-bar mode control with preview moves here. Depends on 1.2, 2.1. Done when: the Sign-in failure, First run, mode-saves-immediately and aggregate-color scenarios pass.
- [x] 2.3 Restyle conflict items: consequence cards mapped to `keepRemote` and `keepLocalCopy`, emphasized Compare side by side, secondary Open conflict copy and Mark resolved, Waiting for sync, a one-line empty state and a history link. Depends on 1.2. Done when: the existing conflict confirmation and review tests pass with the new labels, plus the secondary Mark resolved scenario.

## 3. Transfer

- [x] 3.1 Add `generateTransferPhrase()` to `packages/plugin/src/config-transfer.ts` (4×4 characters, 32-symbol unambiguous alphabet, `crypto.getRandomValues`). Done when: `tests/unit/config-transfer.test.ts` checks format, alphabet, uniqueness across calls, and round-trip with the existing encrypted payload.
- [x] 3.2 Update Send settings: prefilled replaceable phrase, included-items list, Copy link, Copy code only, `navigator.share` on mobile when present, explicit unprotected opt-out, and disabled with an explanation on `AUTH_ERROR`. Receive settings reuses import unchanged. Depends on 2.2, 3.1. Done when: the protected-by-default and broken-credentials scenarios pass and the existing opt-out test passes.

## 4. Server and Advanced

- [x] 4.1 Merge Connection and Attachments into one `server` draft: read-only bound vault ID, saved-secret rows with Replace, S3 switch, edited markers, changed-field count bar, and the switch modal kept. Depends on 1.2. Done when: the unsaved change bar scenario, validation focus, keep/discard, and attachments on/off tests pass.
- [x] 4.2 Advanced: inline limit with default, device ID copy, Diagnostics group with debug logging and Copy status report built by `buildStatusReport` in `packages/plugin/src/diagnostics.ts`. Done when: the redacted-report scenario and existing inline-limit commit tests pass.

## 5. Styling and docs

- [x] 5.1 Rewrite `packages/plugin/styles.css` for the new sections using only Obsidian theme variables, with `body.is-mobile` / narrow-container rules for one column, 44 px targets, a bottom save bar and a conflict sheet. Done when: a grep finds no hex colors in the new rules, and `lint` and `build:plugin` pass.
- [x] 5.2 Update user docs that name old tabs (`docs/iphone-setup.md`, `README.md` if applicable). Done when: `rg "Device transfer|Overview tab"` finds no stale user-facing references.

## 6. Verification

- [x] 6.1 Run `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run build:plugin`, and `openspec validate redesign-settings-ui --strict`. Done when: all pass, with the output summarized in the PR description.

## 7. Owner acceptance (deferrable)

- [x] 7.1 In a disposable vault, compare desktop light, desktop dark and one mobile device against `docs/design/settings-ui/reference/`: synchronized, conflict, sign-in failure, first run, Server draft and Send settings. Done when: captures are saved under `docs/design/settings-ui/captures/` or deviations are listed in `design-qa.md`. Owner accepted the live result on 2026-09-30; reference captures remain pending.
