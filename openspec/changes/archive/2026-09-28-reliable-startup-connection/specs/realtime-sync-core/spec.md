## MODIFIED Requirements

### Requirement: Secure realtime remote state
The plugin SHALL authenticate to NATS over WSS with the configured vault's username and password stored in Obsidian SecretStorage. It SHALL open only that vault's existing KV bucket and expose connection, pending-work, and convergence state locally. It SHALL NOT treat `vaultId` or the bucket name as authorization.

#### Scenario: Independent vaults share one NATS server
- **WHEN** two local vaults use different configured vault IDs and KV buckets on the same NATS server
- **THEN** each plugin instance reads, watches, and writes only records in its configured bucket

#### Scenario: Active devices receive a Markdown update
- **WHEN** two active devices connect to the same configured vault and one publishes an eligible Markdown update
- **THEN** the other device receives the remote record through its watch and normally applies it within one second after local debounce completes

#### Scenario: Credentials are persisted
- **WHEN** a user saves NATS credentials
- **THEN** the plugin stores the password in SecretStorage and does not write it to plugin `data.json`, a connection URL, or logs

#### Scenario: Credentials are rejected or revoked
- **WHEN** NATS rejects authentication during connection or reconnection
- **THEN** the plugin reports an authentication error, retains local files and outbox operations, and does not replay them until valid credentials are configured

### Requirement: Converged status is truthful
The plugin SHALL report `SYNCED` only when connected, complete startup or reconnect reconciliation has established a current remote snapshot and live delivery, no applicable outbox work remains, no unresolved conflict exists, and required blob transfers are complete. If primary discovery uses a recoverable fallback, `SYNCED` SHALL remain withheld until that fallback completes.

#### Scenario: Connected does not mean synchronized
- **WHEN** the WSS connection is open but reconciliation is still running
- **THEN** the status is not reported as `SYNCED`

#### Scenario: Discovery fallback is in progress
- **WHEN** primary remote discovery cannot establish completion and its complete-discovery fallback is running
- **THEN** the status is not reported as `SYNCED` until the fallback has completed and all other convergence conditions hold

### Requirement: Configured vault reconnects automatically after startup and resume
When valid connection settings are saved, the plugin SHALL automatically attempt a WSS connection after Obsidian startup readiness and SHALL resume connection attempts when network connectivity returns or the app resumes from suspension. Transient failures SHALL use bounded automatic retries; authentication and configuration failures SHALL stop automatic retries until credentials or settings change or the user requests a manual retry. Each automatic retry series SHALL have at most one active connection attempt and SHALL NOT create duplicate sync engines or unbounded retry timers. The existing manual Connect or Retry connection action SHALL remain available.

#### Scenario: Startup connects a configured vault
- **WHEN** Obsidian becomes ready with valid saved settings and the endpoint accepts a connection
- **THEN** the plugin connects, completes startup reconciliation, and starts normal synchronization without a manual Connect action

#### Scenario: Startup endpoint is temporarily unavailable
- **WHEN** the initial connection fails for a transient network reason
- **THEN** the plugin reports an offline/retrying state, makes only bounded automatic retries, and retries again when connectivity returns or Obsidian resumes

#### Scenario: Startup credentials are rejected
- **WHEN** the initial connection is rejected because credentials are invalid
- **THEN** the plugin reports an authentication error and makes no repeated automatic attempts until settings change or the user manually retries

#### Scenario: Repeated readiness signals overlap
- **WHEN** startup, an online event, and an app-resume event arrive while a connection attempt is already active
- **THEN** the plugin maintains at most one active connection attempt and one sync engine

#### Scenario: Manual retry remains available
- **WHEN** automatic retries have stopped after authentication failure or exhaustion
- **THEN** the user can invoke the existing manual retry action and receive the resulting connection status
