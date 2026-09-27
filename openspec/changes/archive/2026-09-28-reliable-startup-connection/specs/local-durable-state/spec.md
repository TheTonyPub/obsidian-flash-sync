## MODIFIED Requirements

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
