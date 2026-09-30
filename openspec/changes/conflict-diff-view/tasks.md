## Execution notes

- Read `proposal.md`, `design.md`, both spec deltas, and `docs/design/settings-ui/reference/Diff-*.png` with `design-qa.md`. Then read `createConflictReview`, `compareConflict` and `ConfirmConflictActionModal` in `packages/plugin/src/main.ts`, plus `packages/plugin/src/conflict-review-note.ts`.
- Apply after `redesign-settings-ui`, or on top of it; its Compare side by side action performs Review comparison.
- Base branch `origin/dev`. Plugin-only and local-only: no release, tag, host or real-vault actions.
- One owner carries tests, code and docs. For each behavior task, record the failing test (RED), then the passing test (GREEN). Never log or fixture real note content or secrets.
- Evidence: `npm run test:unit`, `npm run typecheck`, `npm run lint`, `npm run build:plugin`.

## 1. Diff model

- [ ] 1.1 Move the LCS and the abbreviated fallback from `conflict-review-note.ts` into `packages/plugin/src/conflict-compare/diff-model.ts` as `diffLines(remote, local)`. It returns typed rows with line numbers, hunks and `abbreviated`. Done when: `tests/unit/conflict-diff-model.test.ts` covers equal, changed, inserted, deleted, CRLF, empty and over-limit inputs.
- [ ] 1.2 Render `formatConflictReviewNote` from the model. Done when: the existing `tests/unit/conflict-review-note.test.ts` passes unchanged.

## 2. Compare view

- [ ] 2.1 Add `ConflictCompareView` (`flash-sync-compare`) in `packages/plugin/src/conflict-compare/compare-view.ts`, register it in `main.ts`, and open it from Review comparison in a new tab with `operationId` state. Done when: tests show that Review comparison opens the view, writes no vault file, and Settings still renders no comparison body.
- [ ] 2.2 Render the side-by-side and unified layouts: line numbers, `−`/`+` markers, hatched gaps, Changes only with 6-line collapse and 3 context lines, heading groups in unified, and defaults for mobile and panes under 700 px. Done when: the highlight, collapse and mobile scenarios pass.
- [ ] 2.3 Add actions: Keep server version and Keep my version through `ConfirmConflictActionModal` to `keepRemote` / `keepLocalCopy`; More… with Open conflict copy, Save as note and Mark resolved; a stale banner with Refresh; and resolved/waiting states on conflict-change updates. Depends on 2.1. Done when: the stale-action, resolved-elsewhere and save-snapshot scenarios pass.
- [ ] 2.4 Handle limits: a metadata-only table for binary or oversized sides, an abbreviated notice with Save as note, a 2,000-row cap, and no content in logs. Done when: the oversized scenario passes and a log-capture test finds no note text.

## 3. Styling

- [ ] 3.1 Add compare-view styles to `packages/plugin/styles.css` using `--color-red-rgb`, `--color-green-rgb`, `--text-faint` and other theme variables only; 44 px mobile action buttons. Done when: no hex colors appear in the new rules, and `lint` and `build:plugin` pass.

## 4. Verification

- [ ] 4.1 Run `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run build:plugin`, and `openspec validate conflict-diff-view --strict`. Done when: all pass, with the output summarized in the PR.

## 5. Owner acceptance (deferrable)

- [ ] 5.1 In a disposable vault with a staged conflict, compare desktop light and dark and one phone against `docs/design/settings-ui/reference/Diff-*.png`. Done when: captures are saved under `docs/design/settings-ui/captures/` or deviations are listed in `design-qa.md`.
