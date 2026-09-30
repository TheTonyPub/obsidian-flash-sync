# settings-ui Specification

## Purpose
Organizes the plugin settings around the next action in three sections, Sync, Server and Advanced, on desktop and mobile.

## Requirements

### Requirement: Settings use three sections
Settings SHALL offer exactly Sync, Server and Advanced, in that order, opening on Sync: keyboard-navigable tabs on desktop, a full-width segmented control on mobile. The Sync tab SHALL show the non-zero count of conflicts needing a decision; the Server tab SHALL mark a server or attachment-storage error.

#### Scenario: Conflict count on tab
- **WHEN** settings open while two conflicts need a decision
- **THEN** Sync is selected and its tab shows the count 2 next to its label

### Requirement: Sync summarizes state and next action
Sync SHALL show, in order: status summary, conflicts, transfer, status-bar mode. The summary SHALL show the aggregate label, one sentence, server, attachment and upload-queue values, and the last reconciliation time when known. While configured it SHALL offer Sync now. On an authentication error it SHALL offer Update password (opens Server) and Paste transfer code. When unconfigured it SHALL offer Paste transfer code first and Set up manually second.

#### Scenario: Sign-in failure
- **WHEN** NATS rejects the vault credentials
- **THEN** the summary names the failure, says local edits stay queued, and offers both recovery actions

#### Scenario: First run
- **WHEN** no connection is configured
- **THEN** Sync offers Paste transfer code and Set up manually instead of connection values

### Requirement: Conflicts are resolvable from Sync
An expanded unresolved conflict SHALL show both choices with their consequence: Keep server version performs Keep remote; Keep my version performs Keep local copy. Compare side by side performs Review comparison and SHALL be emphasized; Open conflict copy and Mark resolved stay secondary. A conflict pending sync SHALL show Waiting for sync with no actions. Without conflicts, Sync SHALL show a one-line empty state and a history link.

#### Scenario: Manual resolution stays secondary
- **WHEN** the user expands a conflict needing a decision
- **THEN** Mark resolved is present but secondary to both choices and Compare side by side

### Requirement: Transfer is reachable from Sync
Sync SHALL offer Send settings and Receive settings via the existing export and import flows. Export SHALL prefill a replaceable generated phrase of at least 80 bits, list what the code includes, offer Copy link, and on mobile offer the share sheet when available. Unprotected export SHALL stay an explicit, warned opt-out. Send settings SHALL be unavailable while saved credentials fail authentication.

#### Scenario: Protected export by default
- **WHEN** the user opens Send settings
- **THEN** a generated phrase protects the QR code and link, and the phrase is not in the link

#### Scenario: Broken credentials
- **WHEN** the connection state is an authentication error
- **THEN** Send settings is disabled with an explanation and Receive settings remains available

### Requirement: Server edits one staged draft
Server SHALL edit connection and attachment fields as one staged draft. A bound vault ID SHALL be read-only; saved secrets SHALL show a saved state with Replace. Only while the draft differs from saved settings, a persistent bar SHALL show the changed-field count with Discard and Save and reconnect. Leaving with changes SHALL keep the apply, discard or keep choice.

#### Scenario: Unsaved change bar
- **WHEN** the user edits only the server address
- **THEN** that field is marked edited and the bar shows 1 unsaved change until saved or discarded

### Requirement: Advanced keeps rarely changed controls
Advanced SHALL contain the inline note limit with its default, the device ID with Copy, debug logging and Copy status report. The report SHALL hold status, queue counts and redacted recent errors, never passwords, secret keys, transfer codes or URL credentials.

#### Scenario: Status report is redacted
- **WHEN** the user copies the report while the last error contains a URL with credentials
- **THEN** the copied text omits the credentials and has no secret values

### Requirement: Layout adapts to platform and theme
Settings SHALL take colors only from Obsidian theme variables and SHALL NOT carry status by color alone. On mobile they SHALL use one column, 44 px controls, labels above inputs, a bottom Server save bar, and a sheet for conflict actions.

#### Scenario: Dark theme
- **WHEN** Obsidian uses its default dark theme
- **THEN** settings text, controls and status labels use theme variables and stay readable
