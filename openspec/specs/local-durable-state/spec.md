# local-durable-state Specification

## Purpose

Preserves local file identity and unsynchronized mutations across offline operation, crashes, and reconnects.

## Requirements

### Requirement: Stable local identity and durable outbox
The plugin SHALL maintain a local file index with a stable `fileId` independent of path. It SHALL durably record each local synchronized mutation in IndexedDB before attempting its remote write.

#### Scenario: Offline mutation survives restart
- **WHEN** a device edits an included file while disconnected and Obsidian restarts before reconnection
- **THEN** the mutation remains in the outbox and is eligible for later synchronization

### Requirement: Pending work is retained safely
The plugin SHALL retain an outbox mutation until its remote write succeeds or its content is preserved as a conflict copy. It SHALL retry pending work with bounded backoff after connectivity returns and SHALL not replay pending work until an authenticated connection is established and complete reconciliation has finished.

#### Scenario: NATS outage does not destroy local content
- **WHEN** NATS becomes unavailable during a local edit
- **THEN** the local file remains usable and the pending mutation is not discarded

#### Scenario: Reconnection waits for complete reconciliation
- **WHEN** a device has pending outbox mutations and reconnects automatically after startup or resume
- **THEN** it retains those mutations until authentication and complete reconciliation succeed, then replays them using the existing conflict-preserving write flow

#### Scenario: Authentication failure retains pending work
- **WHEN** automatic startup or reconnect receives an authentication rejection
- **THEN** pending mutations remain durable and are not replayed until credentials are corrected and a connection and reconciliation succeed

### Requirement: Durable path-release dependency
The plugin SHALL durably retain the dependency between a path-releasing delete and a path-reusing operation across retries and restarts. It SHALL keep the dependent operation pending until the release is confirmed remotely, then retry it without requiring another local edit.

#### Scenario: Delete publish fails
- **WHEN** the remote delete of A fails before B's rename can use A's path
- **THEN** B's rename remains pending and is not published ahead of A's tombstone

#### Scenario: Restart between release and reuse
- **WHEN** the plugin restarts after A's tombstone reaches remote state but before B's rename is confirmed
- **THEN** replay recognizes the confirmed release and completes B's rename without duplicating or losing either mutation

#### Scenario: Rename callback arrives before delete callback
- **WHEN** the local vault has removed A and moved B to A's path but the rename is captured before A's delete event
- **THEN** the durable outbox still records A's delete as B's predecessor and never publishes B ahead of A

#### Scenario: Crash before local event capture
- **WHEN** Obsidian has removed A and moved B but the plugin restarts before either event is durably queued
- **THEN** local reconciliation recovers the identity-scoped delete and dependent rename when B can be identified, or preserves the changed content for conflict review when identity is ambiguous
