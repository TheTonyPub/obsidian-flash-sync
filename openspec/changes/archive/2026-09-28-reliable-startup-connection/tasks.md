## 1. Establish the startup failure and regression cases

- [x] 1.1 Reproduce and record the startup path from Obsidian readiness through settings and SecretStorage reads, initial WSS result, engine creation, and online/resume signals; distinguish confirmed observations from hypotheses.
- [x] 1.2 Add failing plugin lifecycle regression coverage for a transient initial connection failure followed by online or resume recovery without a manual Connect action.
- [x] 1.3 Add failing coverage for authentication/configuration failure stopping automatic retries, bounded transient retries, overlapping startup/online/resume signals, and unload/settings-change cleanup.
- [x] 1.4 Add failing coverage proving pending outbox mutations wait for authenticated connection and complete reconciliation before replay, and remain durable through failed attempts.

## 2. Implement coordinated automatic recovery

- [x] 2.1 Implement one serialized connection coordinator for startup, online, and app-resume triggers, with a single in-flight attempt and no duplicate sync-engine creation.
- [x] 2.2 Add capped backoff with a finite attempt budget for transient failures; allow a fresh bounded series on connectivity return or app resume after exhaustion.
- [x] 2.3 Stop automatic retries on authentication or invalid-configuration failures until settings change or manual retry, and clear timers/state on unload.
- [x] 2.4 Preserve manual Connect/Retry behavior and keep outbox replay behind successful authentication and complete reconciliation.
- [x] 2.5 Report unconfigured, authentication failure, offline/retrying, connected/reconciling, and synchronized states truthfully; choose and document retry count and delay cap.

## 3. Verify behavior on supported platforms

- [x] 3.1 Run focused plugin lifecycle, connection-classification, outbox, and reconciliation tests; confirm every regression case from section 1 passes.
- [x] 3.2 Verify fresh startup and transient-outage recovery on desktop and mobile resume, including that no sync engine or retry timer is duplicated.
- [x] 3.3 Confirm an authentication rejection stops automatic retries, manual retry still works after settings correction, and local files/outbox remain intact.
