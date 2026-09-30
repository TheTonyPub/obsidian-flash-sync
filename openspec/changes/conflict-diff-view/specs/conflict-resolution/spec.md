## MODIFIED Requirements

### Requirement: Users resolve conflicts deliberately
The plugin SHALL show every unresolved conflict as a collapsed, expandable item in Settings. The expanded item SHALL provide resolution actions, a Review comparison action that opens the compare view outside Settings, and an on-demand Save as note action that creates and opens a separate Markdown review note in a dedicated, visible vault folder. Settings SHALL NOT render the comparison body. The note SHALL label the live remote original and preserved local copy with paths, detection-time remote revision and content identities, current identities, snapshot time, and stale warnings. For text versions, it SHALL show their line differences. Binary or oversized versions SHALL be compared by metadata only and SHALL NOT be loaded into the comparison or audit event as content. Review notes SHALL be excluded from synchronization, SHALL NOT be overwritten or deleted automatically, and SHALL NOT themselves resolve a conflict. Resolving one conflict SHALL NOT resolve, delete, overwrite, or discard the files or pending work of another conflict.

#### Scenario: User opens a conflict review
- **WHEN** the user expands one conflict and selects Review comparison
- **THEN** the plugin opens the compare view for that conflict, while Settings remains a compact list without inline comparison content

#### Scenario: User saves a review snapshot
- **WHEN** the user selects Save as note for one conflict
- **THEN** the plugin creates a new Markdown snapshot in the dedicated review folder and opens it in Obsidian

#### Scenario: Review note remains local
- **WHEN** the plugin writes or the user edits a review note
- **THEN** the note is not captured, queued, uploaded, or used as a resolution input

#### Scenario: Live comparison has changed after detection
- **WHEN** the remote original or preserved local copy changes after conflict detection
- **THEN** the comparison identifies the changed live version as stale against its detection metadata and does not present the stale view as the detected version

#### Scenario: Binary or oversized version is reviewed
- **WHEN** either side of a conflict is binary or exceeds the inline comparison limit
- **THEN** the comparison shows only its path, identity, size, hash, and remote revision when applicable, without reading or logging its content

#### Scenario: User keeps the remote original
- **WHEN** the user selects Keep remote for one unresolved conflict
- **THEN** after confirming the live remote revision and expected canonical-path identity, the plugin makes that remote version the canonical-path local result, retains any displaced local canonical content as a recoverable backup referenced by the selected record, and marks the selected record resolved only after the canonical local file matches that remote revision

#### Scenario: User keeps the preserved local copy
- **WHEN** the user selects Keep local copy for one unresolved conflict
- **THEN** after confirming the live remote revision and expected canonical-path identity, the plugin makes that copy the canonical-path local result, retains any displaced local canonical content as a recoverable backup referenced by the selected record, and queues a compare-and-set update against the reviewed remote revision

#### Scenario: User resolves after manual edits
- **WHEN** the user edits or deletes files to resolve one conflict and explicitly marks it resolved
- **THEN** the plugin rechecks the live remote revision and canonical-path state, queues a compare-and-set update or deletion when synchronization is required, and does not mark the selected record resolved until that work is confirmed

#### Scenario: A reviewed version becomes stale before action
- **WHEN** the remote revision changes after the user reviewed a conflict and before an action is committed
- **THEN** the plugin does not overwrite the newer remote version, retains the selected conflict as unresolved, and requires refreshed review

#### Scenario: Canonical path changes unexpectedly before action
- **WHEN** the canonical-path local version differs from the reviewed identity before an action is committed
- **THEN** the plugin does not displace it, retains the selected conflict as unresolved, and requires refreshed review
