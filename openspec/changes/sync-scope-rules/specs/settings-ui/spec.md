## ADDED Requirements

### Requirement: Advanced edits the sync scope
Advanced SHALL contain a Sync scope group with a mode choice (Exclude, Only selected), a monospaced pattern editor with a short syntax hint, the built-in skip list toggle, and a live preview that shows how many vault files and which sample paths are in and out of scope. Saving SHALL apply the scope without a restart. Only selected with an empty list SHALL show a warning that nothing will sync. When held operations exist, Sync SHALL show how many and a link to Sync scope.

#### Scenario: Preview before saving
- **WHEN** the user types `code/` in the editor
- **THEN** the preview shows the number of files that would leave scope and a few example paths before the user saves

#### Scenario: Empty Only selected list
- **WHEN** the user picks Only selected with no patterns
- **THEN** a warning says nothing will sync and Save stays available
