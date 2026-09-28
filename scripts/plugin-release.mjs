import { execFileSync } from "node:child_process";
import { access, appendFile, copyFile, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const TAG_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc|dev)\.([1-9]\d*))?$/;
const PLUGIN_ID = "flash-sync";

export function parseTag(tag) {
  const match = TAG_PATTERN.exec(tag);
  if (!match) throw new Error(`Unsupported plugin tag: ${tag}`);
  const baseVersion = `${match[1]}.${match[2]}.${match[3]}`;
  const suffix = match[4];
  const channel = !suffix ? "stable" : suffix === "dev" ? "development" : "prerelease";
  return { tag, baseVersion, channel, branch: channel === "stable" ? "master" : "dev", releaseBranch: `release/${baseVersion}` };
}

async function readManifest(path) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read plugin manifest at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (manifest.id !== PLUGIN_ID || manifest.name !== PLUGIN_ID) {
    throw new Error(`Plugin manifest id and name must both be ${PLUGIN_ID}`);
  }
  return manifest;
}

async function validateManifestBase(repository, releaseTag) {
  const manifest = await readManifest(join(repository, "packages/plugin/manifest.json"));
  if (manifest.version !== releaseTag.baseVersion) {
    throw new Error(`Plugin manifest version ${manifest.version} does not match tag base ${releaseTag.baseVersion}`);
  }
  return manifest;
}

export function validateBranchReachability(repository, commit, branch) {
  try {
    execFileSync("git", ["-C", repository, "merge-base", "--is-ancestor", commit, `refs/remotes/origin/${branch}`], { stdio: "ignore" });
  } catch {
    throw new Error(`Tag commit ${commit} is not reachable from origin/${branch}`);
  }
}

async function validate({ tag, commit, repository, githubOutput }) {
  const releaseTag = parseTag(tag);
  await validateManifestBase(repository, releaseTag);
  let branch = releaseTag.branch;
  try { validateBranchReachability(repository, commit, branch); }
  catch (error) {
    if (releaseTag.channel !== "prerelease") throw error;
    branch = releaseTag.releaseBranch;
    validateBranchReachability(repository, commit, branch);
  }
  if (githubOutput) {
    await appendFile(githubOutput, `tag=${tag}\nbase_version=${releaseTag.baseVersion}\nchannel=${releaseTag.channel}\nbranch=${branch}\n`);
  }
  process.stdout.write(`Validated ${tag} (${releaseTag.channel}, origin/${branch})\n`);
}

export function resolveTag(repository, tag) {
  parseTag(tag);
  return execFileSync("git", ["-C", repository, "rev-parse", "--verify", `refs/tags/${tag}^{commit}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

export function validatePublication({ tag, sourceTag, repository }) {
  const destination = parseTag(tag);
  const source = parseTag(sourceTag);
  if (destination.channel === "development" || source.channel !== "prerelease") throw new Error("Publication requires a candidate source tag");
  if (destination.baseVersion !== source.baseVersion) throw new Error("Candidate and destination base versions differ");
  if (destination.channel === "prerelease" && tag !== sourceTag) throw new Error("Prerelease publication must use the same source tag");
  const commit = resolveTag(repository, tag);
  if (commit !== resolveTag(repository, sourceTag)) throw new Error("Candidate and destination must resolve to the exact same commit");
  validateBranchReachability(repository, commit, destination.channel === "stable" ? "master" : destination.releaseBranch);
  const manifest = JSON.parse(execFileSync("git", ["-C", repository, "show", `${commit}:packages/plugin/manifest.json`], { encoding: "utf8" }));
  if (manifest.id !== PLUGIN_ID || manifest.name !== PLUGIN_ID || manifest.version !== destination.baseVersion) throw new Error("Tagged source manifest does not match publication");
  return { ...destination, commit, sourceTag };
}

export async function packageDistribution({ tag, repository, directory }) {
  const releaseTag = parseTag(tag);
  const manifest = await validateManifestBase(repository, releaseTag);
  const output = resolve(directory);
  const mainSource = join(repository, "packages/plugin/dist/main.js");
  await access(mainSource);
  await mkdir(output, { recursive: true });
  const mainTarget = join(output, "main.js");
  const manifestTarget = join(output, "manifest.json");
  const styleSource = join(repository, "packages/plugin/styles.css");
  const styleTarget = join(output, "styles.css");
  await copyFile(mainSource, mainTarget);
  await writeFile(manifestTarget, `${JSON.stringify({ ...manifest, version: tag }, null, 2)}\n`);
  try {
    await access(styleSource);
    await copyFile(styleSource, styleTarget);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await rm(styleTarget, { force: true });
  }
}

export async function verifyDistribution({ tag, directory }) {
  const releaseTag = parseTag(tag);
  const output = resolve(directory);
  if (!(await lstat(output)).isDirectory()) throw new Error("Installation path must be a regular directory");
  const files = (await readdir(output)).sort();
  const allowed = files.includes("styles.css") ? ["main.js", "manifest.json", "styles.css"] : ["main.js", "manifest.json"];
  if (JSON.stringify(files) !== JSON.stringify(allowed)) {
    throw new Error(`Unexpected installation files: ${files.join(", ")}`);
  }
  for (const file of files) {
    if (!(await lstat(join(output, file))).isFile()) throw new Error(`Installation file must be regular: ${file}`);
  }
  if ((await readFile(join(output, "main.js"))).length === 0) throw new Error("main.js is empty");
  const manifest = await readManifest(join(output, "manifest.json"));
  if (manifest.version !== tag) throw new Error(`Distribution manifest version ${manifest.version} does not match tag ${tag}`);
  if (manifest.version.split("-")[0] !== releaseTag.baseVersion) throw new Error("Distribution manifest base version does not match tag");
  if (files.includes("styles.css") && (await readFile(join(output, "styles.css"))).length === 0) {
    throw new Error("styles.css is empty");
  }
}

export function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

export async function fileHashes(directory) {
  const result = {};
  for (const name of (await readdir(directory)).sort()) result[name] = sha256(await readFile(join(directory, name)));
  return result;
}

export async function createArtifact({ tag, repository, directory, context = process.env }) {
  const releaseTag = parseTag(tag);
  if (releaseTag.channel === "stable") throw new Error("Stable tags use candidate promotion, not compilation");
  const commit = resolveTag(repository, tag);
  const head = execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (head !== commit || context.GITHUB_SHA !== commit || context.GITHUB_REF !== `refs/tags/${tag}`) throw new Error("Build context does not match tagged checkout");
  const install = join(directory, "install");
  await packageDistribution({ tag, repository, directory: install });
  await verifyDistribution({ tag, directory: install });
  const metadata = {
    schemaVersion: 1, repository: context.GITHUB_REPOSITORY, tag, commit,
    baseVersion: releaseTag.baseVersion, channel: releaseTag.channel,
    workflowPath: ".github/workflows/ci.yml", workflowRef: context.GITHUB_WORKFLOW_REF,
    runId: context.GITHUB_RUN_ID, runAttempt: context.GITHUB_RUN_ATTEMPT,
    nodeVersion: process.version, lockfileHash: sha256(await readFile(join(repository, "package-lock.json"))),
    files: await fileHashes(install),
  };
  await writeFile(join(directory, "build-info.json"), `${JSON.stringify(metadata, null, 2)}\n`);
  await verifyArtifact({ tag, directory });
  return metadata;
}

export async function verifyArtifact({ tag, directory }) {
  if (!(await lstat(directory)).isDirectory()) throw new Error("Artifact must be a regular directory");
  const entries = (await readdir(directory)).sort();
  if (JSON.stringify(entries) !== JSON.stringify(["build-info.json", "install"])) throw new Error("Unexpected artifact entries");
  if (!(await lstat(join(directory, "build-info.json"))).isFile()) throw new Error("Metadata must be a regular file");
  const metadata = JSON.parse(await readFile(join(directory, "build-info.json"), "utf8"));
  const parsed = parseTag(tag);
  const hashPattern = /^[a-f0-9]{64}$/;
  if (metadata.schemaVersion !== 1 || metadata.tag !== tag || metadata.baseVersion !== parsed.baseVersion || metadata.channel !== parsed.channel
    || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(metadata.repository ?? "") || !/^[a-f0-9]{40}$/.test(metadata.commit ?? "")
    || !/^[1-9]\d*$/.test(metadata.runId ?? "") || !/^[1-9]\d*$/.test(metadata.runAttempt ?? "")
    || metadata.workflowPath !== ".github/workflows/ci.yml"
    || metadata.workflowRef !== `${metadata.repository}/${metadata.workflowPath}@refs/tags/${tag}`
    || !/^v\d+\.\d+\.\d+$/.test(metadata.nodeVersion ?? "") || !hashPattern.test(metadata.lockfileHash ?? "")) throw new Error("Invalid artifact build metadata");
  const install = join(directory, "install");
  await verifyDistribution({ tag, directory: install });
  const hashes = await fileHashes(install);
  if (!metadata.files || JSON.stringify(Object.keys(metadata.files).sort()) !== JSON.stringify(Object.keys(hashes))) throw new Error("Artifact hash file set differs");
  for (const [name, hash] of Object.entries(hashes)) if (metadata.files[name] !== hash) throw new Error(`Artifact hash mismatch: ${name}`);
  return metadata;
}

export async function promoteArtifact({ tag, sourceTag, repository, artifact, directory }) {
  const publication = validatePublication({ tag, sourceTag, repository });
  const metadata = await verifyArtifact({ tag: sourceTag, directory: artifact });
  if (metadata.commit !== publication.commit) throw new Error("Artifact source differs from publication commit");
  if (resolve(directory) === resolve(join(artifact, "install"))) throw new Error("Promotion must not modify source artifact");
  await mkdir(directory, { recursive: true });
  for (const name of Object.keys(metadata.files)) await copyFile(join(artifact, "install", name), join(directory, name));
  if (publication.channel === "stable") {
    const manifest = await readManifest(join(directory, "manifest.json"));
    await writeFile(join(directory, "manifest.json"), `${JSON.stringify({ ...manifest, version: tag }, null, 2)}\n`);
  }
  await verifyDistribution({ tag, directory });
  const hashes = await fileHashes(directory);
  for (const [name, hash] of Object.entries(metadata.files)) {
    if (name !== "manifest.json" || publication.channel !== "stable") {
      if (hashes[name] !== hash) throw new Error(`Promotion changed tested bytes: ${name}`);
    }
  }
  return { publication, metadata, hashes };
}

export function options(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) throw new Error("Expected --option value pairs");
    if (Object.hasOwn(result, key.slice(2))) throw new Error(`Duplicate option: ${key}`);
    result[key.slice(2)] = value;
  }
  return result;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const values = options(args);
  const tag = values.tag;
  if (!tag) throw new Error("Missing --tag");
  if (command === "validate") {
    if (!values.commit) throw new Error("Missing --commit");
    await validate({ tag, commit: values.commit, repository: resolve(values.repo ?? "."), githubOutput: values["github-output"] });
  } else if (command === "validate-publication") {
    const publication = validatePublication({ tag, sourceTag: values["source-tag"], repository: resolve(values.repo ?? ".") });
    process.stdout.write(`Validated publication ${tag} (${publication.commit})\n`);
  } else if (command === "package") {
    if (!values.directory) throw new Error("Missing --directory");
    await packageDistribution({ tag, repository: resolve(values.repo ?? "."), directory: values.directory });
    process.stdout.write(`Packaged ${tag}\n`);
  } else if (command === "verify") {
    if (!values.directory) throw new Error("Missing --directory");
    await verifyDistribution({ tag, directory: values.directory });
    process.stdout.write(`Verified installation files for ${tag}\n`);
  } else if (command === "artifact") {
    if (!values.directory) throw new Error("Missing --directory");
    await createArtifact({ tag, repository: resolve(values.repo ?? "."), directory: resolve(values.directory) });
    process.stdout.write(`Created verified artifact ${tag}\n`);
  } else if (command === "verify-artifact") {
    await verifyArtifact({ tag, directory: resolve(values.directory) });
    process.stdout.write(`Verified artifact ${tag}\n`);
  } else if (command === "promote") {
    await promoteArtifact({ tag, sourceTag: values["source-tag"], repository: resolve(values.repo ?? "."), artifact: resolve(values.artifact), directory: resolve(values.directory) });
  } else {
    throw new Error("Usage: plugin-release.mjs validate|package|verify --tag TAG [options]");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
