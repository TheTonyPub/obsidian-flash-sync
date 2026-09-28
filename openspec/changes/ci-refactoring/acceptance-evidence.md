# CI refactoring acceptance evidence

Date: 2026-09-28. Initial scope: local implementation and disposable fixtures. Authorized live prerelease acceptance follows below; live stable publication remains unverified.

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

The source manifest hash remained `fd0f21b765ae42f1c304e2dcd18cf24b402ab48ebde17d322fcb7d40a4b7b1db`. This direct helper smoke fixture omitted the repository's actual stylesheet; it was a partial fixture, not the complete installation package. The separate publication stylesheet fixture retained SHA-256 `c82fd32af0cd811f34e96170a1ebb1016c2bf8898124889090471903d622ca9a` across candidate/stable promotion. Publication fixture JavaScript deliberately throws if executed; the publisher only reads/hashes/copies it. Live acceptance below verifies the actual stylesheet too.

## Workflow and documentation review

Compared final CI against the existing workflow: PR/dev/master triggers, typecheck, lint, plugin build, unit coverage, dev/master Gist badge conditions, CLI bundles, integration, Docker NATS/MinIO, simulation, aggregate coverage and always-upload coverage diagnostics remain. Added release-branch checks, early validation and attempt-specific installation artifacts; removed the automatic publication job and duplicate tag compilation. Stable tags now validate and provide instructions only.

Both workflows passed actionlint; focused YAML tests check command inventory, gates, inputs, permissions, trusted dispatch ref, concurrency and pinned action references. Newly pinned actions were verified through read-only GitHub tag-object resolution: checkout v4 `11d5960a326750d5838078e36cf38b85af677262`, setup-node v4 `49933ea5288caeca8642d1e84afbd3f7d6820020`, upload-artifact v4 `ea165f8d65b6e75b540449e92b4886f43607fa02`.

Checked all local Markdown link targets: README 22 links, CONTRIBUTION 3, AGENTS 5. Every documented npm script exists. AGENTS has 106 lines and no personal filesystem paths. Manually reviewed Mermaid flow and checked node/edge references (design: 19 nodes/18 edges; CONTRIBUTION: 18 nodes/17 edges). Changed the release-branch node to "ensure" so the fix loop does not instruct recreating an existing branch. No visual renderer was used; diagram layout/rendering remains unverified.

Changed executable behavior is confined to release tooling/workflows. No plugin/protocol/server-CLI source, credential implementation, dependency lockfile, or deployed-state paths changed. Local Docker tests used disposable containers and volumes; no operator-owned infrastructure was configured or mutated.

## Required owner integration and platform limitations

At initial local acceptance, read-only GitHub API confirmed `TheTonyPub/obsidian-flash-sync` is public and its default branch is `dev`. Looking up `.github/workflows/plugin-publish.yml` on `dev` returned 404: the new workflow was still local. The prerequisites for separately authorized integration/publication were:

1. Make the new build workflow available on candidate source branches and the publication workflow/helpers available on the actual repository default branch. This does not change the separate stable-source `master` requirement.
2. Verify repository/organization Actions artifact retention allows the requested 90 days and that the selected artifact remains downloadable. Expiry/deletion requires an explicitly created and tested new candidate; publication never rebuilds.
3. Configure owner-controlled tag/branch protections and publication access; immutable releases are recommended. These settings were not inspected or changed as acceptance prerequisites for local implementation.
4. Exercise live draft creation, asset upload/download verification, latest status, retry and GitHub concurrency only with explicit authorization. Local API fixtures prove helper decisions, not hosted GitHub execution or immutable-release behavior.

During initial local acceptance, no repository branches were merged, pushed, or deleted; no live tags/releases or GitHub settings were created or altered. Existing public releases remained untouched. Main OpenSpec specs were not synced and the change was not archived.

## Authorized live prerelease acceptance

The owner subsequently authorized testing without a stable release. Integration [PR #15](https://github.com/TheTonyPub/obsidian-flash-sync/pull/15) passed [GitHub checks](https://github.com/TheTonyPub/obsidian-flash-sync/actions/runs/36463527145) and merged into default `dev` as `293b631fe746c37d58b6b611380f2f8c6593f40c`. The publication workflow then became active on GitHub. [Dev integration CI](https://github.com/TheTonyPub/obsidian-flash-sync/actions/runs/36463853109) passed, including existing badge behavior.

Annotated `0.2.1-dev.1` and `0.2.1-beta.1` tags both point to that commit. Their [development build](https://github.com/TheTonyPub/obsidian-flash-sync/actions/runs/36463976971) and [candidate build](https://github.com/TheTonyPub/obsidian-flash-sync/actions/runs/36463977995) passed with one plugin compilation per tag build and separate normal-success installation uploads. Authenticated release listing confirmed neither a published Release nor a draft existed for either tag after their builds.

| Source | Exact artifact identity | Archive SHA-256 |
| --- | --- | --- |
| `0.2.1-dev.1` | Run `36463976971`, attempt `1`, artifact `10989390618` | `a22654d0cdca38f7d5990a9fe43739032f4f787d0b62625e8aff2581758afaf5` |
| `0.2.1-beta.1` | Run `36463977995`, attempt `1`, artifact `10989255707` | `32cf044f05ca00f0657c8a5b7986931e2fb277fe2c76bda82b61d958de8b2938` |

Both installation artifacts were downloaded and passed `verify-artifact` using Node.js 22. Their metadata records the exact tag, commit, run/attempt, approved workflow ref, Node `v22.23.2`, lockfile SHA-256 `961e6ab4f149c1441b290ffa86515091c8c65b29ff479d6bef583ff878a4615b`, and all three installation files. GitHub expiry is `2026-12-27T18:16:00Z`, confirming the requested 90-day retention window from the run start.

[Publication before branch creation](https://github.com/TheTonyPub/obsidian-flash-sync/actions/runs/36464364111) failed as expected: `Tag commit 293b631fe746c37d58b6b611380f2f8c6593f40c is not reachable from origin/release/0.2.1`. Authenticated listing confirmed no draft or Release was created. The matching branch was then created at that commit; its [ordinary branch CI](https://github.com/TheTonyPub/obsidian-flash-sync/actions/runs/36464651505) passed.

The [first eligible publication attempt](https://github.com/TheTonyPub/obsidian-flash-sync/actions/runs/36464692087) exposed a transport bug before Release mutation: `Invalid GitHub API path`. The guard rejected GitHub's legitimate `base...head` comparison route. [Fix PR #16](https://github.com/TheTonyPub/obsidian-flash-sync/pull/16) narrows rejection to decoded dot path segments, retaining rejection of literal/encoded traversal. A new transport regression failed first; then all 33 publication/workflow tests, typecheck and lint passed. The candidate tag, run, attempt and artifact were preserved for retry.

PR #16 passed [GitHub checks](https://github.com/TheTonyPub/obsidian-flash-sync/actions/runs/36465183992), merged as `ca0485fe5b7188a53be450c3be4a3a48f1f71e06`, and passed [dev integration CI](https://github.com/TheTonyPub/obsidian-flash-sync/actions/runs/36465466508). The exact remote comparison URL then returned `identical` with the expected merge-base SHA.

The [next attempt](https://github.com/TheTonyPub/obsidian-flash-sync/actions/runs/36465527893) verified source/run/artifact identity but failed downloading the archive with HTTP 415. No draft was created. The transport incorrectly requested octet-stream from the Actions archive redirect endpoint. [GitHub's artifact API](https://docs.github.com/en/rest/actions/artifacts#download-an-artifact) uses GitHub JSON media type; [release asset downloads](https://docs.github.com/en/rest/releases/assets#get-a-release-asset) use octet-stream. Read-only HEAD requests reproduced 415 for the incorrect type and succeeded with the correct type. Two new transport tests verify endpoint-specific types and no token forwarding to signed storage redirects; the Actions archive case failed before the fix, then all 35 publication/workflow tests, typecheck and lint passed.

[Fix PR #17](https://github.com/TheTonyPub/obsidian-flash-sync/pull/17) also encountered an existing aggregate-test race in its [first CI run](https://github.com/TheTonyPub/obsidian-flash-sync/actions/runs/36466157804): 535 tests passed, and `blob-engine.test.ts` expected all KV entries to be absent while upload was blocked. Current source reserves a `p.` path claim before upload and publishes `f.` blob references only afterwards, consistent with `remote-path-ownership` and `blob-storage` specs. Waiting explicitly for upload start reproduced the false assertion deterministically. The corrected test checks the reserved claim and absence of file-content records, then verifies the content after upload; it uses fixture cleanup and changes no runtime behavior. All 39 focused blob/publication/workflow tests, typecheck and lint passed locally after correction.

PR #17 passed its [final GitHub CI run](https://github.com/TheTonyPub/obsidian-flash-sync/actions/runs/36467042061) and merged as `0a43eece4e948687cda59625aca58a540c5410f0`. CI passed 501 unit tests and 536 aggregate tests across 68 files, including disposable NATS/MinIO. Aggregate coverage was lines 86.41%, branches 82.96%, functions 94.39%; unit coverage was 84.95% / 82.22% / 92.97%. Typecheck, lint, plugin/CLI builds, integration, simulation, and all other original checks passed.

### Successful publication and repeated request

The [successful publication run](https://github.com/TheTonyPub/obsidian-flash-sync/actions/runs/36467604657) published [0.2.1-beta.1](https://github.com/TheTonyPub/obsidian-flash-sync/releases/tag/0.2.1-beta.1), Release ID `398528645`, at `2026-09-28T18:47:05Z`. It consumed the original candidate run `36463977995`, attempt `1`, artifact `10989255707` from commit `293b631fe746c37d58b6b611380f2f8c6593f40c`. The candidate was not rebuilt or retagged. The publication workflow ran no dependency installation or plugin compilation.

Authenticated release metadata confirms `draft=false`, `prerelease=true`, and exactly three uploaded installation assets. Independently downloaded asset bytes passed installation verification and matched every selected artifact hash:

| Published asset | Asset ID | Original artifact and published SHA-256 |
| --- | --- | --- |
| `main.js` | `596142725` | `685bae76de8c965ec8698bf61bb430279d768b6ac78468509c7379547389fa6c` |
| `manifest.json` | `596142762` | `63a62038c0c5a145f3c5433d30260a04107aea6425f6586e1c1f4d8f972d7c22` |
| `styles.css` | `596142799` | `7ffd433714f508f0d414375d1f7ac55dbdd505920ed566ed9760275e8aee3eb1` |

The public manifest version is exactly `0.2.1-beta.1`. All asset creation/upload timestamps precede publication. Separately downloaded `publication-evidence-36467604657-1` confirms the original commit/run/attempt/artifact, archive digest, and identical `sourceFiles`/`files` hashes; internal metadata was not attached as a Release installation asset.

The [repeat run](https://github.com/TheTonyPub/obsidian-flash-sync/actions/runs/36467965532) succeeded and reported `already-published`. Before/after API snapshots were equal for Release ID, channel/draft/immutability flags, created/published/updated timestamps, asset IDs, names, states, sizes, digests, and asset timestamps. Downloads may increment download counters; those counters are not evidence of content mutation and were excluded from the snapshots.

`GET /releases/latest` returned 404 before publication, after publication, and after retry: there was no stable release and the new prerelease did not become latest. `0.2.1-dev.1` remains an internal artifact with no Release. No stable tag or stable Release was created, no tag was moved, and no existing asset was replaced or deleted. GitHub repository settings and operator-owned infrastructure were unchanged.

### Remaining platform limits

- Live stable promotion was deliberately excluded by owner scope; exact-SHA/manifest-only stable promotion remains verified through local fixtures.
- The tested Release reports `immutable=false`. Publication under enabled immutable releases remains unverified.
- A real interrupted-draft upload/resume and concurrent publication requests were not induced; local API fixtures and workflow concurrency checks cover those cases.
- Real artifact expiry/deletion and corrupt provenance were not induced; the rejection fixtures cover them. Actual 90-day retention and legitimate provenance were verified on GitHub.
- Pinned v4 actions emitted Node.js 20 deprecation annotations while GitHub forced their action runtime to Node.js 24. The configured test/build Node.js 22 runtime and all checks passed; major action upgrades remain follow-up work.

Main OpenSpec specs remain unsynced and the change remains active, ready for separate review/archive.
