## Context

See proposal.md for motivation. The plugin already initiates connection during startup, but an unsuccessful initial WSS attempt can leave no sync engine for later reconciliation triggers to use. NATS connection code distinguishes authentication failures from transient failures; startup recovery must preserve that distinction and the existing durable outbox/reconciliation ordering.

## Goals / Non-Goals

**Goals:**
- Diagnose the observed startup failure with reproducible lifecycle and connection-state evidence before choosing the smallest correction.
- Coordinate startup, online, and resume-triggered attempts so they share one in-flight attempt and cannot create duplicate engines.
- Retry transient failures with capped backoff and a finite attempt budget per automatic series; let online/resume events start a fresh bounded series after exhaustion.
- Stop automatic retries for authentication or invalid-configuration failures until settings change or the user invokes the existing manual retry.
- Keep outbox replay behind successful authentication and complete reconciliation.

**Non-Goals:**
- Changing credential storage, the NATS protocol, bucket permissions, or infrastructure deployment.
- Background synchronization while a mobile app is suspended.
- Replacing the existing manual Connect/Retry connection action or changing conflict-resolution policy.

## Decisions

- First establish the failure path from observable startup timing, settings and SecretStorage readiness, connection result, and engine creation. Record which observations are reproduced and keep unverified causes labeled as hypotheses; do not encode an assumed root cause as a requirement.
- Use one serialized connection/retry coordinator shared by startup and lifecycle triggers. It owns a single in-flight attempt, one bounded retry timer, cancellation/reset when settings change or the plugin unloads, and engine creation only after a successful connection. This avoids separate event handlers racing to create engines.
- Limit each automatic series to five total attempts, including the initial connection attempt. Retry delays are 1, 2, 4, and 8 seconds, with a 15-second cap for future adjustment; online and app-resume signals can begin a fresh bounded series after replacing any pending delay. Manual retry and changed connection settings also reset the series.
- Reuse the existing connection error classification where reliable. Authentication or validation failures enter a non-retrying state; transient network failures enter bounded capped backoff. A credentials/settings change or explicit manual retry resets the automatic retry series. Online and app-resume triggers may each begin a new bounded series after exhaustion, but must not stack timers or attempts.
- Preserve the existing durable outbox and complete-discovery gate. Automatic reconnect establishes authenticated connectivity, performs complete reconciliation, and only then resumes pending writes through the established CAS/conflict-preservation path.
- Keep status presentation truthful: distinguish unconfigured, authentication failure, offline/retrying, connected/reconciling, and synchronized states using existing status surfaces where possible.

## Risks / Trade-offs

- [Obsidian readiness and resume events differ by platform/version] → Keep the retry coordinator platform-neutral and validate the lifecycle triggers on desktop and mobile.
- [Error text may classify some server failures ambiguously] → Test known auth and transient connector failures; preserve diagnostics and fail closed from automatic retry when classification indicates authentication/configuration failure.
- [Retry budget may expire during a long outage] → Online and resume events start a fresh bounded series, while the manual retry remains available.
- [Connection opens before remote state is safe to apply] → Keep outbox replay and `SYNCED` behind complete reconciliation.

## Migration Plan

No persisted schema or server migration is expected. Ship the plugin behavior change; rollback consists of reinstalling the prior plugin build. Local IndexedDB and outbox formats remain unchanged.

## Open Questions

- What finite attempt count and backoff cap best fit Obsidian's startup and mobile resume lifecycle? Select and document concrete values during implementation without changing the behavioral contract of bounded retries.
