## Why

CI currently publishes alpha/beta tags immediately, coupling candidate creation to public release and offering no separate stabilization gate. Separate verified builds from publication so development can continue while selected artifacts become prereleases and stable releases without recompilation.

## What Changes

- **BREAKING**: Alpha/beta tag pushes produce tested candidate artifacts instead of automatically creating GitHub prereleases. Publication becomes an explicit workflow operation.
- Keep development tags as CI artifacts only; add optional `rc.N` candidate tags and temporary `release/x.y.z` stabilization branches.
- Build each selected tagged candidate once, record its source and artifact identity, and promote those files after verifying successful checks, branch eligibility, manifest version, and hashes.
- Publish stable `x.y.z` tags from the accepted candidate commit on `master`, reusing the tested JavaScript and changing only the installation manifest version. Reject source mismatches or missing artifacts rather than silently rebuilding.
- Create complete draft releases before publication, make stable releases latest, and make publication retries verify existing assets instead of replacing them.
- Preserve existing type, lint, unit, integration, simulation, CLI bundle, coverage, and badge behavior while removing redundant compilation and separating publication permissions.
- Add root `CONTRIBUTION.md` with branch, PR, candidate, release, and verification instructions plus a release-cycle diagram.
- Add compact root `AGENTS.md` covering plugin and `fos` concepts, repository layout, architectural invariants, development checks, and branch/release rules, with links to detailed existing guides.
- Update README release instructions and badges to match the implemented channels.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `plugin-release-distribution`: Separate tag builds from explicit publication; require candidate provenance and stabilization eligibility; define stable promotion without recompilation and consistent contributor guidance.

## Impact

- Affected implementation: `.github/workflows/ci.yml`, additional build/publication workflow files, `scripts/plugin-release.mjs`, focused release tests, and artifact metadata.
- Affected documentation: `README.md`, new `CONTRIBUTION.md` and `AGENTS.md`, and the release distribution specification. Preserve existing NATS and CLI guides as references.
- Changes GitHub Actions triggers, installation artifact lifecycle, and publication permissions. Existing releases and tags remain unchanged; historical releases without new build evidence are not automatically eligible for promotion.
- Preserve plugin data contracts: vault isolation, stable file identity, durable outbox, CAS-based reconciliation, optional S3, SecretStorage, and conflict preservation. No runtime behavior changes are planned.
- Non-goals: server deployment/configuration, NATS/S3 operations, CLI runtime changes or CLI release packaging, Community Directory publication, automatic branch merging, creating live release tags during planning, and modifying GitHub protection/immutability settings without separate authorization.
