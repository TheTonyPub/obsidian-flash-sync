## Context

`createConflictReview` in `packages/plugin/src/main.ts` calls `compareConflict` and writes `formatConflictReviewNote` output into `CONFLICT_REVIEW_FOLDER`. `conflict-review-note.ts` has an LCS `lineDiff` (capped by `MAX_LCS_CELLS`, abbreviated beyond it) that returns fenced text. `ConflictComparison` already carries content only for inline-sized text and stale flags. Visual reference: `docs/design/settings-ui/reference/Diff-*.png`.

## Decisions

1. **Structured diff model.** `diffLines(remote, local)` in `conflict-compare/diff-model.ts` returns rows `{ kind: "same" | "remote" | "local", remoteLine?, localLine?, text }`, grouped into hunks, plus `abbreviated`. It moves the existing LCS and the prefix/suffix fallback out of `conflict-review-note.ts`, and the note renders from the same model. Rejected: a new diff dependency (bundle size, and nothing is missing at line level).
2. **Workspace view.** `ConflictCompareView extends ItemView` is registered once as `flash-sync-compare` and opened with `workspace.getLeaf("tab")`. Its state holds only `operationId`, and content is reloaded through `compareConflict` on open and refresh. Nothing is written to the vault, so nothing can sync. Rejected: a modal, which is too narrow for side by side and cannot stay open next to the note.
3. **Layout.** Desktop defaults to side by side: removed/added runs pair row by row, and missing counterparts are hatched. Mobile (`Platform.isMobile`) and panes narrower than 700 px use unified rows grouped under the nearest preceding Markdown heading. The toggle lasts for the view's lifetime. Changes only is on by default and collapses unchanged runs longer than 6 lines, keeping 3 lines of context on each side.
4. **Theme colors.** Tints use `rgba(var(--color-red-rgb), .12)` and `rgba(var(--color-green-rgb), .12)`. Line numbers use `--text-faint`, and `−`/`+` markers plus side labels carry meaning without color. Rejected: the mockup hex palette.
5. **Decisions reuse resolution.** Keep server version and Keep my version open `ConfirmConflictActionModal`, then call `keepRemote` / `keepLocalCopy`. More… holds Open conflict copy, Save as note (the current snapshot flow) and Mark resolved. The view subscribes to conflict changes and switches to a resolved or waiting state with choices disabled.
6. **Limits.** Binary or oversized sides show a metadata table only. An abbreviated model shows a notice and offers Save as note. At most 2,000 changed rows render. Content never reaches logs or audit events.

## Risks / Trade-offs

- [The view stays open after an out-of-band resolution] → refresh on the conflict-change subscription and on focus.
- [Stale versions] → show a Changed since detection banner with Refresh; actions keep the existing stale and CAS rejection.
- [Large notes slow rendering] → collapsed runs render lazily, and the row cap matches the note.
- [Snapshot note tests depend on the text format] → keep the note output byte-compatible except for shared model internals.

## Migration

No persisted data changes. Existing review notes stay untouched. The view type registers on load and detaches on unload.
