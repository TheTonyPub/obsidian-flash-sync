import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL, URL } from "node:url";
import { options, parseTag, promoteArtifact, sha256, validatePublication, verifyArtifact } from "./plugin-release.mjs";

const requiredSteps = ["typecheck", "lint", "build plugin", "unit coverage", "CLI bundle tests", "integration tests", "NATS recovery tests", "S3 blob tests", "simulation tests", "aggregate coverage", "package installation artifact", "upload installation artifact"];
const extractionScript = `import pathlib, stat, sys, zipfile
root = pathlib.Path(sys.argv[2])
allowed = {"build-info.json", "install/main.js", "install/manifest.json", "install/styles.css"}
with zipfile.ZipFile(sys.argv[1]) as archive:
    entries = archive.infolist()
    seen = set()
    if sum(entry.file_size for entry in entries) > 128 * 1024 * 1024:
        raise ValueError("Artifact is too large")
    for entry in entries:
        name = entry.filename
        mode = entry.external_attr >> 16
        if name == "install/" and entry.is_dir():
            continue
        if name not in allowed or name in seen or entry.is_dir() or stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0, stat.S_IFREG)):
            raise ValueError("Unsafe or unexpected artifact path: " + name)
        seen.add(name)
    if not {"build-info.json", "install/main.js", "install/manifest.json"}.issubset(seen):
        raise ValueError("Artifact lacks required files")
    for entry in entries:
        if entry.filename in allowed:
            target = root / entry.filename
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(entry))
`;

function requireMatch(condition, message) { if (!condition) throw new Error(message); }
function positive(value) { return typeof value === "string" && /^[1-9]\d*$/.test(value); }

export function validateInputs(inputs) {
  requireMatch(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(inputs.repositoryName ?? ""), "Invalid repository identity");
  for (const name of ["runId", "runAttempt", "artifactId"]) requireMatch(positive(inputs[name]), `Invalid ${name}`);
  const destination = parseTag(inputs.tag);
  const source = parseTag(inputs.sourceTag);
  requireMatch(source.channel === "prerelease" && destination.channel !== "development", "Development tags cannot be published");
  requireMatch(destination.baseVersion === source.baseVersion, "Source and destination base versions differ");
  requireMatch(destination.channel === "stable" || inputs.tag === inputs.sourceTag, "Prerelease requires the same source tag");
  return destination;
}

export async function extractArtifact(bytes, workDirectory) {
  requireMatch(bytes.length <= 128 * 1024 * 1024, "Artifact archive is too large");
  const archive = join(workDirectory, "artifact.zip");
  const directory = join(workDirectory, "artifact");
  await mkdir(workDirectory, { recursive: true });
  await writeFile(archive, bytes);
  execFileSync("python3", ["-c", extractionScript, archive, directory], { stdio: ["ignore", "pipe", "pipe"] });
  return directory;
}

async function remoteCommit(api, prefix, tag) {
  let object = (await api.json("GET", `${prefix}/git/ref/tags/${encodeURIComponent(tag)}`)).object;
  for (let depth = 0; object?.type === "tag" && depth < 10; depth++) {
    requireMatch(/^[a-f0-9]{40}$/.test(object.sha), "Invalid annotated tag object");
    object = (await api.json("GET", `${prefix}/git/tags/${object.sha}`)).object;
  }
  requireMatch(object?.type === "commit" && /^[a-f0-9]{40}$/.test(object.sha), "Tag does not resolve to a commit");
  return object.sha;
}

async function verifyRemoteSource(api, prefix, inputs, publication) {
  requireMatch(await remoteCommit(api, prefix, inputs.tag) === publication.commit, "Destination tag changed or differs from checkout");
  requireMatch(await remoteCommit(api, prefix, inputs.sourceTag) === publication.commit, "Source tag changed or differs from checkout");
  const branch = publication.channel === "stable" ? "master" : publication.releaseBranch;
  const comparison = await api.json("GET", `${prefix}/compare/${publication.commit}...${encodeURIComponent(`refs/heads/${branch}`)}`);
  requireMatch(["identical", "ahead"].includes(comparison.status) && comparison.merge_base_commit?.sha === publication.commit, "Destination commit is not reachable from required remote branch");
}

async function verifyBuild(api, prefix, inputs, publication, repositoryInfo) {
  const workflow = await api.json("GET", `${prefix}/actions/workflows/ci.yml`);
  const run = await api.json("GET", `${prefix}/actions/runs/${inputs.runId}/attempts/${inputs.runAttempt}`);
  requireMatch(String(run.id) === inputs.runId && String(run.run_attempt) === inputs.runAttempt
    && run.repository?.full_name === inputs.repositoryName && run.head_repository?.full_name === inputs.repositoryName
    && run.workflow_id === workflow.id && workflow.path === ".github/workflows/ci.yml"
    && run.path?.split("@")[0] === workflow.path && run.event === "push" && run.head_branch === inputs.sourceTag
    && run.head_sha === publication.commit && run.status === "completed" && run.conclusion === "success", "Source run does not match approved successful tag build");
  const jobs = [];
  for (let page = 1; ; page++) {
    const response = await api.json("GET", `${prefix}/actions/runs/${inputs.runId}/attempts/${inputs.runAttempt}/jobs?per_page=100&page=${page}`);
    jobs.push(...response.jobs);
    if (jobs.length >= response.total_count) break;
    requireMatch(response.jobs.length > 0, "Incomplete build job evidence");
  }
  const validation = jobs.find(job => job.name === "validate");
  const checks = jobs.find(job => job.name === "checks");
  requireMatch(validation?.status === "completed" && validation.conclusion === "success" && checks?.status === "completed" && checks.conclusion === "success", "Required build jobs did not pass");
  for (const name of requiredSteps) requireMatch(checks.steps?.some(step => step.name === name && step.conclusion === "success"), `Required build check did not pass: ${name}`);
  const artifact = await api.json("GET", `${prefix}/actions/artifacts/${inputs.artifactId}`);
  const created = Date.parse(artifact.created_at);
  requireMatch(String(artifact.id) === inputs.artifactId && !artifact.expired
    && artifact.name === `flash-sync-${inputs.sourceTag}-${inputs.runId}-${inputs.runAttempt}`
    && String(artifact.workflow_run?.id) === inputs.runId && artifact.workflow_run.head_sha === publication.commit
    && artifact.workflow_run.head_branch === inputs.sourceTag
    && artifact.workflow_run.repository_id === repositoryInfo.id && artifact.workflow_run.head_repository_id === repositoryInfo.id
    && created >= Date.parse(checks.started_at) && created <= Date.parse(checks.completed_at), "Artifact is expired or does not belong to the selected build attempt");
  return artifact;
}

async function verifyAsset(api, prefix, asset, hash) {
  requireMatch(asset.state === "uploaded", `Incomplete uploaded asset: ${asset.name}`);
  if (asset.digest) requireMatch(asset.digest === `sha256:${hash}`, `Release asset digest differs: ${asset.name}`);
  const bytes = await api.bytes(`${prefix}/releases/assets/${asset.id}`);
  requireMatch(sha256(bytes) === hash, `Release asset bytes differ: ${asset.name}`);
}

async function findRelease(api, prefix, tag) {
  try { return await api.json("GET", `${prefix}/releases/tags/${encodeURIComponent(tag)}`); }
  catch (error) { if (error.status !== 404) throw error; }
  // The tag endpoint returns published releases only. Authenticated lists include drafts.
  for (let page = 1; ; page++) {
    const releases = await api.json("GET", `${prefix}/releases?per_page=100&page=${page}`);
    const matching = releases.find(release => release.tag_name === tag);
    if (matching) return matching;
    if (releases.length < 100) return null;
  }
}

export async function publishInstallation({ inputs, context, api, repository, workDirectory }) {
  const destination = validateInputs(inputs);
  const prefix = `/repos/${inputs.repositoryName}`;
  const repositoryInfo = await api.json("GET", prefix);
  requireMatch(repositoryInfo.full_name === inputs.repositoryName && context.eventName === "workflow_dispatch"
    && context.ref === `refs/heads/${repositoryInfo.default_branch}`
    && context.workflowRef === `${inputs.repositoryName}/.github/workflows/plugin-publish.yml@refs/heads/${repositoryInfo.default_branch}`, "Publication must run from the trusted default branch");
  const publication = validatePublication({ tag: inputs.tag, sourceTag: inputs.sourceTag, repository });
  await verifyRemoteSource(api, prefix, inputs, publication);
  const artifactInfo = await verifyBuild(api, prefix, inputs, publication, repositoryInfo);
  const archive = await api.bytes(`${prefix}/actions/artifacts/${inputs.artifactId}/zip`);
  if (artifactInfo.digest) requireMatch(artifactInfo.digest === `sha256:${sha256(archive)}`, "Artifact archive digest mismatch");
  const artifact = await extractArtifact(archive, workDirectory);
  const metadata = await verifyArtifact({ tag: inputs.sourceTag, directory: artifact });
  const sourceLockfile = execFileSync("git", ["-C", repository, "show", `${publication.commit}:package-lock.json`]);
  requireMatch(metadata.repository === inputs.repositoryName && metadata.commit === publication.commit
    && metadata.runId === inputs.runId && metadata.runAttempt === inputs.runAttempt
    && metadata.lockfileHash === sha256(sourceLockfile), "Artifact metadata differs from source build");
  const directory = join(workDirectory, "install");
  const promoted = await promoteArtifact({ tag: inputs.tag, sourceTag: inputs.sourceTag, repository, artifact, directory });
  const proof = `Source: ${inputs.sourceTag}\nCommit: ${publication.commit}\nBuild: ${inputs.runId}, attempt ${inputs.runAttempt}\nArtifact: ${inputs.artifactId}\nFiles: ${JSON.stringify(promoted.hashes)}`;
  await writeFile(join(workDirectory, "publication-info.json"), `${JSON.stringify({ tag: inputs.tag, ...inputs, commit: publication.commit, sourceFiles: metadata.files, files: promoted.hashes, artifactDigest: artifactInfo.digest ?? null }, null, 2)}\n`);
  let release = await findRelease(api, prefix, inputs.tag);
  if (release) {
    requireMatch(release.tag_name === inputs.tag && release.prerelease === (destination.channel === "prerelease") && release.body?.includes(proof), "Existing release has conflicting source or channel");
    const seen = new Set();
    for (const asset of release.assets) {
      requireMatch(Object.hasOwn(promoted.hashes, asset.name) && !seen.has(asset.name), "Existing release has unexpected or duplicate assets");
      seen.add(asset.name);
      await verifyAsset(api, prefix, asset, promoted.hashes[asset.name]);
    }
    if (!release.draft) {
      requireMatch(seen.size === Object.keys(promoted.hashes).length, "Published release is incomplete");
      return { status: "already-published", tag: inputs.tag, hashes: promoted.hashes };
    }
  }
  await verifyRemoteSource(api, prefix, inputs, publication);
  if (!release) release = await api.json("POST", `${prefix}/releases`, {
    tag_name: inputs.tag, name: inputs.tag, draft: true, prerelease: destination.channel === "prerelease",
    body: `Flash Sync ${destination.channel === "stable" ? "stable release" : "prerelease"} for manual installation.\n\n${proof}`,
    make_latest: "false",
  });
  for (const [name, hash] of Object.entries(promoted.hashes)) {
    if (release.assets.some(asset => asset.name === name)) continue;
    const asset = await api.upload(release.upload_url, name, await readFile(join(directory, name)));
    await verifyAsset(api, prefix, asset, hash);
  }
  const complete = await api.json("GET", `${prefix}/releases/${release.id}`);
  requireMatch(complete.id === release.id && complete.tag_name === inputs.tag && complete.draft === true
    && complete.prerelease === (destination.channel === "prerelease") && complete.body?.includes(proof), "Draft source, channel, or status changed");
  requireMatch(complete.assets.length === Object.keys(promoted.hashes).length, "Draft asset set is incomplete");
  const names = new Set();
  for (const asset of complete.assets) {
    requireMatch(Object.hasOwn(promoted.hashes, asset.name) && !names.has(asset.name), "Draft has conflicting assets");
    names.add(asset.name);
    await verifyAsset(api, prefix, asset, promoted.hashes[asset.name]);
  }
  await verifyRemoteSource(api, prefix, inputs, publication);
  await api.json("PATCH", `${prefix}/releases/${release.id}`, { draft: false, prerelease: destination.channel === "prerelease", make_latest: destination.channel === "stable" ? "true" : "false" });
  return { status: "published", tag: inputs.tag, hashes: promoted.hashes };
}

export function createGitHubApi(token) {
  requireMatch(typeof token === "string" && token.length > 0, "Missing GitHub publication token");
  const headers = { Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "flash-sync-publication" };
  async function request(method, path, body, accept = "application/vnd.github+json") {
    requireMatch(path.startsWith("/repos/") && !path.includes(".."), "Invalid GitHub API path");
    const response = await globalThis.fetch(`https://api.github.com${path}`, { method, headers: { ...headers, Accept: accept, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual", signal: globalThis.AbortSignal.timeout(60000) });
    if (!response.ok && response.status !== 302) throw Object.assign(new Error(`GitHub ${method} ${path} failed (${response.status})`), { status: response.status });
    return response;
  }
  return {
    async json(method, path, body) { return (await request(method, path, body)).json(); },
    async bytes(path) {
      let response = await request("GET", path, undefined, "application/octet-stream");
      if (response.status === 302) {
        const url = new URL(response.headers.get("location"));
        requireMatch(url.protocol === "https:", "Unsafe artifact download redirect");
        response = await globalThis.fetch(url, { signal: globalThis.AbortSignal.timeout(60000) });
        requireMatch(response.ok, "Artifact or asset download failed");
      }
      return Buffer.from(await response.arrayBuffer());
    },
    async upload(template, name, bytes) {
      const url = new URL(template.split("{")[0]);
      requireMatch(url.origin === "https://uploads.github.com" && url.pathname.startsWith("/repos/"), "Unsafe release upload URL");
      url.searchParams.set("name", name);
      const response = await globalThis.fetch(url, { method: "POST", headers: { ...headers, "Content-Type": "application/octet-stream" }, body: bytes, redirect: "error", signal: globalThis.AbortSignal.timeout(60000) });
      requireMatch(response.ok, `Asset upload failed (${response.status}): ${name}`);
      return response.json();
    },
  };
}

async function main() {
  const values = options(process.argv.slice(2));
  const result = await publishInstallation({
    inputs: { tag: values.tag, sourceTag: values["source-tag"], runId: values["build-run-id"], runAttempt: values["build-run-attempt"], artifactId: values["artifact-id"], repositoryName: process.env.GITHUB_REPOSITORY },
    context: { eventName: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF, workflowRef: process.env.GITHUB_WORKFLOW_REF },
    api: createGitHubApi(process.env.GH_TOKEN), repository: resolve(values.repo ?? "."), workDirectory: resolve(values.directory),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => {
  process.stderr.write(`${error.message}\n`); process.exitCode = 1;
});
