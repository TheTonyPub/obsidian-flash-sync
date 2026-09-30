## MODIFIED Requirements

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
