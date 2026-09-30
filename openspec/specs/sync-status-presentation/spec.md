# sync-status-presentation Specification

## Purpose
Makes synchronization state visible and actionable in the Obsidian status bar without obscuring unresolved conflicts or pending work.

## Requirements

### Requirement: Status bar offers Minimal and Extended presentation
The plugin SHALL provide a setting in the Sync section with Minimal and Extended status-bar presentation modes and a preview of the selected mode. Minimal mode SHALL show only the state icon. Extended mode SHALL show the same icon and a text label. Selecting either mode SHALL preserve one click target that opens the same status and conflicts view.

#### Scenario: Minimal mode opens status and conflicts
- **WHEN** the user selects Minimal mode and clicks the status-bar indicator
- **THEN** the plugin opens the status and conflicts view from the icon-only control

#### Scenario: Extended mode opens status and conflicts
- **WHEN** the user selects Extended mode and clicks the status-bar indicator
- **THEN** the plugin opens the same status and conflicts view from the icon-plus-text control

#### Scenario: Advanced mode choice saves immediately
- **WHEN** the user selects Minimal or Extended in the Sync section, which replaces the former Advanced location
- **THEN** the new mode is persisted and shown in the status bar and the preview immediately, without a Save or Discard step

### Requirement: Advanced settings commit each control independently
The plugin SHALL save Advanced settings when each control commits and SHALL NOT show Save or Discard buttons on that page. The inline Markdown limit SHALL validate and reconnect synchronization once when a completed value changes. Debug logging and Copy status report SHALL be grouped under Diagnostics at the end of Advanced, and debug logging SHALL save when toggled. The Server section MAY retain its staged Save and Discard workflow.

#### Scenario: Inline limit commits
- **WHEN** the user finishes changing the inline Markdown limit to a valid value
- **THEN** the plugin persists it and reconnects sync once without an additional Save action

#### Scenario: Invalid inline limit is rejected
- **WHEN** the user finishes entering an invalid inline Markdown limit
- **THEN** the plugin does not persist it or reconnect and shows validation feedback

### Requirement: Overview shows aggregate status
The plugin SHALL show the aggregate status in the Sync section summary, which replaces Overview, derived from the same aggregate sync state as the status bar. The summary SHALL pair an icon and text label with a color: green means fully synchronized, yellow means processing or a conflict needing review, red means an error, and gray means offline or disconnected. Color alone SHALL NOT convey status.

#### Scenario: Connected work is not shown as green
- **WHEN** the server is connected but work is pending or conflicts need review
- **THEN** the Sync summary is yellow with an accurate status label rather than green

#### Scenario: Offline and error states are distinguished
- **WHEN** sync enters an error or disconnected state
- **THEN** the Sync summary shows a red or gray state respectively with a matching text label

### Requirement: Status states are distinct and accessible
The plugin SHALL present static status-bar states using a single centrally maintained state-to-icon mapping: syncing uses Cloud Check in a neutral presentation, synchronized success uses Cloud Check in green, errors use Cloud Alert in red, disconnected uses Cloud Off in gray, and unresolved conflicts use File Diff in amber with the unresolved count. The indicator SHALL expose an accessible label and tooltip that distinguish syncing from synchronized success despite their shared icon.

#### Scenario: Syncing and success remain distinguishable
- **WHEN** the plugin transitions from syncing to synchronized with no pending work or unresolved conflicts
- **THEN** the indicator retains the Cloud Check glyph while changing from neutral syncing semantics to green success semantics in its label, tooltip, and Extended text

#### Scenario: Conflict state is distinct from error state
- **WHEN** one or more unresolved conflicts exist
- **THEN** the indicator uses the amber File Diff presentation with the count rather than the error presentation

#### Scenario: Disconnected state is visible
- **WHEN** the plugin is disconnected
- **THEN** the indicator uses the gray Cloud Off presentation and an accessible disconnected label

### Requirement: Success is withheld while work remains
The plugin SHALL NOT present synchronized success while an unresolved conflict, queued synchronization work, reconciliation work, or blob transfer work remains. Unresolved conflicts SHALL take precedence over ordinary errors in the status-bar presentation.

#### Scenario: Pending work suppresses success
- **WHEN** a connection is active but reconciliation, queued work, or blob transfer work remains
- **THEN** the indicator does not present green synchronized success

#### Scenario: Conflict suppresses success
- **WHEN** one or more unresolved conflicts exist while the connection is active
- **THEN** the indicator presents the amber conflict state instead of synchronized success
