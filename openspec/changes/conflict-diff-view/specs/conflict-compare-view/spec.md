## ADDED Requirements

### Requirement: Conflicts open in a highlighted compare view
Review comparison SHALL open one conflict in a dedicated workspace view outside Settings. For text versions, the view SHALL show a line-level diff of the live remote original and the preserved local copy with line numbers. Lines only on the server SHALL be tinted and marked `−`; lines only on this device SHALL be tinted and marked `+`. Colors SHALL come from theme variables, and meaning SHALL NOT rely on color alone. Each side SHALL be labelled with its origin, remote revision or copy, and size. With Changes only on (the default), unchanged runs longer than six lines SHALL collapse to an expandable row with three context lines on each side.

#### Scenario: Changed line is highlighted
- **WHEN** the server has `at 15:00` and this device has `at 16:30` on line 5
- **THEN** the view shows both lines tinted, marked `−` and `+`, with their line numbers

#### Scenario: Unchanged run collapses
- **WHEN** 24 unchanged lines separate two changes and Changes only is on
- **THEN** the view shows context lines and a Show 24 unchanged lines control that expands them

### Requirement: Compare layout follows available width
On desktop, the view SHALL default to side by side with removed and added runs aligned, and SHALL hatch missing counterparts. On mobile and in panes narrower than 700 px, it SHALL default to unified rows grouped under the nearest preceding Markdown heading. The user SHALL be able to switch layouts while the view is open.

#### Scenario: Mobile uses unified rows
- **WHEN** the compare view opens on a phone
- **THEN** changes appear as unified rows under their heading, with no horizontal scrolling for the layout

### Requirement: Decisions from the compare view reuse resolution rules
Keep server version and Keep my version in the view SHALL perform Keep remote and Keep local copy with the same confirmation, stale-version, canonical-path and compare-and-set checks. Open conflict copy, Save as note, and Mark resolved SHALL be secondary actions. When the conflict becomes resolved or waits for synchronization, the view SHALL show that state and disable both choices.

#### Scenario: Version changed after opening
- **WHEN** the remote revision changes while the view is open and the user selects Keep my version
- **THEN** the plugin rejects the stale action as today, keeps the conflict unresolved, and the view offers Refresh

#### Scenario: Resolution completes elsewhere
- **WHEN** the conflict is resolved from Settings while the view is open
- **THEN** the view shows the resolved state and both choices are disabled

### Requirement: Compare view respects content limits
The view SHALL show only metadata for binary or oversized versions. When the diff exceeds the comparison limit, it SHALL show an abbreviated diff with a notice and offer Save as note. The view SHALL NOT write vault files except through Save as note, and SHALL NOT log content.

#### Scenario: Oversized version
- **WHEN** either side exceeds the inline comparison limit
- **THEN** the view shows path, size, hash and revision for each side without reading or rendering content
