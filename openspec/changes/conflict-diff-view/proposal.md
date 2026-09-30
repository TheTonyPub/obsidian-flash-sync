> Approved: 2026-09-30 by the owner.

## Why

Review comparison writes a Markdown snapshot with a fenced `diff` block. Theme highlighting of that block is weak or missing, and the two versions never appear side by side. The user must leave the note to decide. A highlighted compare view lets users see the difference and choose a version in one place.

## What Changes

- Add a compare view: an Obsidian workspace tab with a highlighted line diff and line numbers. It is side by side on desktop, unified on mobile, and collapses unchanged runs.
- Offer Keep server version and Keep my version in the view, reusing the existing confirmations, stale checks and CAS rules.
- Review comparison opens the view. The Markdown snapshot becomes a secondary Save as note action.
- Refactor `lineDiff` into a structured diff model shared by the view and the note.

Non-goals: word-level highlights, merge editing, binary previews, new resolution semantics.

## Impact

- Code: new `packages/plugin/src/conflict-compare/diff-model.ts` and `compare-view.ts`; `conflict-review-note.ts`; `main.ts` (view registration, `createConflictReview`); `packages/plugin/styles.css`.
- Tests: new `tests/unit/conflict-diff-model.test.ts` and `tests/unit/conflict-compare-view.test.ts`; `conflict-review-note.test.ts`; `settings-ui.test.ts`.
- Specs: new `conflict-compare-view`; modified `conflict-resolution`.
- Depends on `redesign-settings-ui`, whose Compare side by side action performs Review comparison.
- Design: `docs/design/settings-ui/reference/Diff-*.png`.
