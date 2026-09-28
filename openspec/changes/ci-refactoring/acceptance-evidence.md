# CI refactoring acceptance evidence

Date: 2026-09-28. Scope: local implementation and disposable fixtures. Live publication remains unverified.

## Implemented behavior

- Tagged development/candidate builds validate before one plugin compilation and retain verified installation artifacts only after all required checks.
- Creating a matching release branch enables explicit candidate publication using the existing tag, run, attempt, and artifact. Branch CI does not publish.
- Stable publication requires the selected candidate's exact commit on `master`; it preserves JavaScript/CSS and changes only manifest version.
- Publication uses trusted default-branch helpers, authoritative GitHub evidence, safe extraction, draft-first upload, full asset verification, and non-destructive retries.
- Root contributor/agent guides and README describe this behavior. `AGENTS.md` is no longer ignored by Git.

## Executed checks

All shell commands used the `rtk` prefix. npm/npx use the installed Node.js dependency; `npm exec -- node --version` returned `v22.23.2`.

| Command | Result |
| --- | --- |
| `npx vitest run tests/unit/plugin-release.test.ts tests/unit/plugin-publication.test.ts tests/unit/ci-workflows.test.ts` | 57 tests passed: 25 release, 30 publication, 2 workflow |
| `npx vitest run tests/unit/plugin-publication.test.ts -t 'draft whose'` | Three final draft-race regressions passed after the last test-only type-narrowing edit |
| `npm run typecheck` | Passed after final edits |
| `npm run lint` | Passed after final edits |
| `npm run test:coverage` | Passed all configured thresholds; LCOV-derived lines 84.95%, branches 82.24%, functions 92.97% |
| `npm run build:plugin` | Passed; emitted `packages/plugin/dist/main.js` |
| `npm run test:server-cli-bundle` | Passed; built and exercised both CLI bundles, one bundle integration test passed |
| Aggregate command below | 68 test files / 530 tests passed, including integration, simulation, Docker NATS recovery and MinIO |
| `/private/tmp/ci-refactoring-tools/actionlint -shellcheck= .github/workflows/ci.yml .github/workflows/plugin-publish.yml` | Passed for both workflows; ShellCheck was unavailable |
| `openspec validate ci-refactoring --strict` | Passed |
| `git diff --check` | Passed |

Exact aggregate invocation:

```sh
rtk env NATS_SERVER_BIN=/private/tmp/obsidian-sync-nats-2.15.0/nats-server-v2.15.0-darwin-arm64/nats-server NATS_TEST_DOCKER=1 S3_TEST_DOCKER=1 npm run test:coverage:aggregate
```

Aggregate V8 report: lines/statements 86.41%, branches 82.97%, functions 94.39%; thresholds remain 80% / 78% / 88%. Coverage configuration measures existing package source, not release helper scripts. The aggregate run preceded the final three draft-race tests; the complete focused 57-test run and final type/lint checks verify those additions. No unchanged service suite was repeated.

Disposable services used local Docker Desktop (Linux arm64 engine), not a hosted server. NATS binary version was `v2.15.0`; its Darwin arm64 archive matched upstream SHA-256 `e1c4e22d70bd44abfa0bcb3c16f7cf0c66f648c2e728c58924e8a1ce88913cc8`. Downloaded actionlint `v1.7.12` Darwin arm64 archive matched `aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f`.

Requirement-derived RED checks preceded tag/branch, artifact, workflow, and publication implementations. Final review added three initially failing tests for a draft whose source/channel/publication status changes during upload. They failed because publication proceeded; the added final draft identity/status check made them pass without a publish PATCH.

## Scenario review

All 28 modified/added scenarios were reviewed against these checks. `R` = release-tool Git/filesystem fixtures; `P` = publication Git/API/archive fixtures; `W` = workflow configuration checks; `D` = documentation review and disposable cycle. Tests live in `tests/unit/plugin-release.test.ts`, `tests/unit/plugin-publication.test.ts`, and `tests/unit/ci-workflows.test.ts`.

| Scenario | Evidence |
| --- | --- |
| Development tag | R tag classification; D internal artifact |
| Prerelease tag | R alpha/beta acceptance; W no automatic Release |
| Candidate before stabilization | R build eligibility without release branch; publication rejected |
| Candidate fix on release branch | R release-only commit accepted before dev integration |
| Same tag promoted after branch creation | R/D prerequisite rejection followed by same-tag promotion |
| Branch contains multiple tags | R explicitly selected older candidate remains selected |
| Stable tag | R exact SHA/base checks; W stable tags skip compilation |
| Wrong branch or malformed tag | R reachability and invalid numeric/tag forms |
| Versioned prerelease build | R artifact manifest/version/identity verification |
| Candidate publication preserves files | P exact asset hashes; D hash table below |
| Stable metadata promotion | R/P unchanged JS/CSS and all other manifest fields |
| Inconsistent installation package | R wrong version, extra files and symlinks; P metadata/file corruption |
| Candidate tag push | W one gated build and artifact; no Release job |
| Stable publication | P stable manifest, minimal asset set, prerelease false/latest true |
| Prerelease publication | P minimal unchanged assets, prerelease true/latest false |
| Custom stylesheet is added later | R optional stylesheet handling; P unchanged stylesheet hash |
| Development artifact | R artifact layout; P rejects development publication |
| Failed verification | W normal-success installation upload and always diagnostic coverage; P zero mutations for rejected evidence |
| Branch creation | W release branch checks only; R existing artifact promotion |
| Valid provenance | P repository/workflow/run/attempt/tag/SHA/artifact/check validation |
| Invalid provenance | P thirteen authoritative-evidence rejection cases, corrupt metadata/files, unsafe archive |
| Expired artifact | P expired metadata and deleted-artifact endpoint 404; no fallback |
| Concurrent request | W per-tag group, cancel-in-progress false; GitHub scheduling itself remains platform-only |
| Interrupted upload | P authenticated draft discovery; existing asset IDs retained on resume |
| Repeat completed publication | P complete matching release causes zero additional mutations |
| Conflicting existing content | P differing bytes, incomplete published set and draft identity/status changes preserved without overwrite |
| Contributor follows release instructions | D commands/links/diagram and disposable dev-to-candidate-to-stable cycle |
| Agent starts a repository task | D 106-line portable AGENTS map, invariants, commands and reference links |

## Fixture hashes and source preservation

A disposable Git repository used the actual built plugin bundle and source manifest, with synthetic `0.2.1-dev.999`, `0.2.1-beta.999`, and `0.2.1` tags. It demonstrated development publication rejection, candidate publication rejection before branch creation, same-tag promotion after creating the release branch, stable exact-commit promotion, and an unchanged source manifest. These tags existed only in the temporary repository, which was removed. This additional direct helper smoke check used host Node.js `v20.20.2`; the npm/npx suites above used Node.js 22.

| File | Development artifact | Candidate artifact and prerelease | Stable installation |
| --- | --- | --- | --- |
| `main.js` | `685bae76de8c965ec8698bf61bb430279d768b6ac78468509c7379547389fa6c` | `685bae76de8c965ec8698bf61bb430279d768b6ac78468509c7379547389fa6c` | `685bae76de8c965ec8698bf61bb430279d768b6ac78468509c7379547389fa6c` |
| `manifest.json` | `a9e8d843571b135820d6a4ce79828f912b2c2a20b5b5ba1174ce3f3bf94f1133` | `e5c03259d36c1382109f5d4bab59eacfdc988dc31f5610ab2a6a0b8f3864cf4a` | `fd0f21b765ae42f1c304e2dcd18cf24b402ab48ebde17d322fcb7d40a4b7b1db` |

The source manifest hash remained `fd0f21b765ae42f1c304e2dcd18cf24b402ab48ebde17d322fcb7d40a4b7b1db`. The current plugin has no stylesheet. The publication stylesheet fixture retained SHA-256 `c82fd32af0cd811f34e96170a1ebb1016c2bf8898124889090471903d622ca9a` across candidate/stable promotion. Publication fixture JavaScript deliberately throws if executed; the publisher only reads/hashes/copies it.

## Workflow and documentation review

Compared final CI against the existing workflow: PR/dev/master triggers, typecheck, lint, plugin build, unit coverage, dev/master Gist badge conditions, CLI bundles, integration, Docker NATS/MinIO, simulation, aggregate coverage and always-upload coverage diagnostics remain. Added release-branch checks, early validation and attempt-specific installation artifacts; removed the automatic publication job and duplicate tag compilation. Stable tags now validate and provide instructions only.

Both workflows passed actionlint; focused YAML tests check command inventory, gates, inputs, permissions, trusted dispatch ref, concurrency and pinned action references. Newly pinned actions were verified through read-only GitHub tag-object resolution: checkout v4 `11d5960a326750d5838078e36cf38b85af677262`, setup-node v4 `49933ea5288caeca8642d1e84afbd3f7d6820020`, upload-artifact v4 `ea165f8d65b6e75b540449e92b4886f43607fa02`.

Checked all local Markdown link targets: README 22 links, CONTRIBUTION 3, AGENTS 5. Every documented npm script exists. AGENTS has 106 lines and no personal filesystem paths. Manually reviewed Mermaid flow and checked node/edge references (design: 19 nodes/18 edges; CONTRIBUTION: 18 nodes/17 edges). Changed the release-branch node to "ensure" so the fix loop does not instruct recreating an existing branch. No visual renderer was used; diagram layout/rendering remains unverified.

Changed executable behavior is confined to release tooling/workflows. No plugin/protocol/server-CLI source, credential implementation, dependency lockfile, or deployed-state paths changed. Local Docker tests used disposable containers and volumes; no operator-owned infrastructure was configured or mutated.

## Required owner integration and platform limitations

Read-only GitHub API confirmed `TheTonyPub/obsidian-flash-sync` is public and its default branch is `dev`. Looking up `.github/workflows/plugin-publish.yml` on `dev` returned 404: the new workflow is local and cannot yet be dispatched remotely. Before separately authorized integration/publication:

1. Make the new build workflow available on candidate source branches and the publication workflow/helpers available on the actual repository default branch. This does not change the separate stable-source `master` requirement.
2. Verify repository/organization Actions artifact retention allows the requested 90 days and that the selected artifact remains downloadable. Expiry/deletion requires an explicitly created and tested new candidate; publication never rebuilds.
3. Configure owner-controlled tag/branch protections and publication access; immutable releases are recommended. These settings were not inspected or changed as acceptance prerequisites for local implementation.
4. Exercise live draft creation, asset upload/download verification, latest status, retry and GitHub concurrency only with explicit authorization. Local API fixtures prove helper decisions, not hosted GitHub execution or immutable-release behavior.

No repository branches were merged, pushed, or deleted; no live tags/releases or GitHub settings were created or altered. Existing public releases remain untouched. Main OpenSpec specs were not synced and the change was not archived.
