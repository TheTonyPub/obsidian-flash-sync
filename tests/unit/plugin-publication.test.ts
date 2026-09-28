import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tooling = await import(new URL("../../scripts/plugin-release.mjs", import.meta.url).href);
let publication: Awaited<ReturnType<typeof importPublication>>;
async function importPublication() { return import(new URL("../../scripts/plugin-publish.mjs", import.meta.url).href); }
let root: string;
let commit: string;
let archive: Buffer;
let metadata: Record<string, unknown>;
const tag = "1.2.3-beta.1";
const inputs = { tag, sourceTag: tag, runId: "123", runAttempt: "2", artifactId: "456", repositoryName: "owner/repo" };
const context = { eventName: "workflow_dispatch", ref: "refs/heads/master", workflowRef: "owner/repo/.github/workflows/plugin-publish.yml@refs/heads/master" };
type Asset = { id: number; name: string; state: string; digest: string };

beforeAll(async () => {
  publication = await importPublication();
  root = await mkdtemp(join(tmpdir(), "flash-sync-publication-"));
  await mkdir(join(root, "packages/plugin/dist"), { recursive: true });
  await writeFile(join(root, "packages/plugin/manifest.json"), JSON.stringify({ id: "flash-sync", name: "flash-sync", version: "1.2.3" }));
  await writeFile(join(root, "packages/plugin/dist/main.js"), 'throw new Error("Artifact code must never execute")');
  await writeFile(join(root, "packages/plugin/styles.css"), ".flash-sync {}");
  await writeFile(join(root, "package-lock.json"), "{\"lockfileVersion\":3}");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  git("init", "--initial-branch=master"); git("config", "user.email", "tests@example.invalid"); git("config", "user.name", "Publication test");
  git("add", "."); git("commit", "-m", "fixture"); commit = git("rev-parse", "HEAD");
  for (const name of [tag, "1.2.3", "1.2.3-dev.1"]) git("tag", "-a", name, "-m", name);
  for (const branch of ["master", "dev", "release/1.2.3"]) git("update-ref", `refs/remotes/origin/${branch}`, commit);
  metadata = await tooling.createArtifact({ tag, repository: root, directory: join(root, "artifact"), context: {
    GITHUB_REPOSITORY: "owner/repo", GITHUB_REF: `refs/tags/${tag}`, GITHUB_SHA: commit,
    GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "2", GITHUB_WORKFLOW_REF: `owner/repo/.github/workflows/ci.yml@refs/tags/${tag}`,
  } });
  execFileSync("python3", ["-c", 'import zipfile, pathlib, sys\nr=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(sys.argv[2],"w") as z:\n for p in r.rglob("*"):\n  if p.is_file(): z.write(p,p.relative_to(r))', join(root, "artifact"), join(root, "artifact.zip")]);
  archive = await readFile(join(root, "artifact.zip"));
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

function apiFixture() {
  const run = { id: 123, run_attempt: 2, repository: { full_name: "owner/repo" }, head_repository: { full_name: "owner/repo" },
    workflow_id: 7, path: ".github/workflows/ci.yml", event: "push", head_branch: tag, head_sha: commit, status: "completed", conclusion: "success" };
  const required = ["typecheck", "lint", "build plugin", "unit coverage", "CLI bundle tests", "integration tests", "NATS recovery tests", "S3 blob tests", "simulation tests", "aggregate coverage", "package installation artifact", "upload installation artifact"];
  const jobs = [{ name: "validate", status: "completed", conclusion: "success", steps: [] }, { name: "checks", status: "completed", conclusion: "success", started_at: "2026-09-28T10:00:00Z", completed_at: "2026-09-28T10:10:00Z", steps: required.map(name => ({ name, conclusion: "success" })) }];
  const artifact = { id: 456, name: `flash-sync-${tag}-123-2`, expired: false, created_at: "2026-09-28T10:09:00Z", digest: `sha256:${tooling.sha256(archive)}`, workflow_run: { id: 123, head_sha: commit, repository_id: 99, head_repository_id: 99, head_branch: tag } };
  const state: { release: null | { id: number; tag_name: string; prerelease: boolean; draft: boolean; body: string; upload_url: string; assets: Asset[] }; bytes: Map<number, Buffer>; mutations: string[] } = { release: null, bytes: new Map(), mutations: [] };
  const json = vi.fn(async (method: string, path: string, body?: Record<string, unknown>) => {
    if (method !== "GET") state.mutations.push(`${method} ${path}`);
    if (path === "/repos/owner/repo") return { id: 99, full_name: "owner/repo", default_branch: "master" };
    if (path.endsWith("/workflows/ci.yml")) return { id: 7, path: ".github/workflows/ci.yml" };
    if (path.endsWith("/attempts/2")) return run;
    if (path.includes("/attempts/2/jobs")) return { total_count: jobs.length, jobs };
    if (path.endsWith("/artifacts/456")) return artifact;
    if (path.includes("/git/ref/tags/")) return { object: { type: "commit", sha: commit } };
    if (path.includes("/compare/")) return { status: "identical", merge_base_commit: { sha: commit } };
    if (method === "GET" && path.includes("/releases/tags/")) {
      if (!state.release || state.release.draft) throw Object.assign(new Error("Not found"), { status: 404 });
      return state.release;
    }
    if (method === "GET" && path.includes("/releases?")) return state.release ? [state.release] : [];
    if (method === "GET" && path.endsWith("/releases/10")) return state.release;
    if (method === "POST" && path.endsWith("/releases")) {
      state.release = { id: 10, tag_name: String(body?.tag_name), prerelease: body?.prerelease === true, draft: true, body: String(body?.body), upload_url: "https://uploads.github.com/repos/owner/repo/releases/10/assets{?name,label}", assets: [] };
      return state.release;
    }
    if (method === "PATCH" && state.release) { state.release.draft = false; return state.release; }
    throw new Error(`Unexpected API call: ${method} ${path}`);
  });
  const bytes = vi.fn(async (path: string) => path.endsWith("/zip") ? archive : state.bytes.get(Number(path.split("/").at(-1)))!);
  const upload = vi.fn(async (_url: string, name: string, data: Buffer) => {
    const asset = { id: 100 + state.bytes.size, name, state: "uploaded", digest: `sha256:${tooling.sha256(data)}` };
    state.bytes.set(asset.id, data); state.release!.assets.push(asset); state.mutations.push(`upload ${name}`); return asset;
  });
  return { api: { json, bytes, upload }, run, jobs, artifact, state };
}

async function publish(fixture: ReturnType<typeof apiFixture>, overrides = {}) {
  const workDirectory = await mkdtemp(join(root, "publish-"));
  return publication.publishInstallation({ inputs: { ...inputs, ...overrides }, context, api: fixture.api, repository: root, workDirectory });
}

describe("verified artifact publication", () => {
  it("allows GitHub commit comparison routes while refusing path traversal", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    try {
      const api = publication.createGitHubApi("fixture-token");
      const comparison = `/repos/owner/repo/compare/${commit}...refs%2Fheads%2Frelease%2F1.2.3`;
      await expect(api.json("GET", comparison)).resolves.toEqual({});
      expect(fetch).toHaveBeenCalledWith(`https://api.github.com${comparison}`, expect.objectContaining({ method: "GET", redirect: "manual" }));
      for (const path of ["/repos/../repo", "/repos/owner/%2e%2e/repo", "/repos/owner/a%2F..%2Fb"])
        await expect(api.json("GET", path)).rejects.toThrow("Invalid GitHub API path");
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });

  it.each([
    ["/actions/artifacts/456/zip", "application/vnd.github+json"],
    ["/releases/assets/100", "application/octet-stream"],
  ])("downloads %s with its required media type and no token on redirects", async (path, accept) => {
    const fetch = vi.fn().mockImplementationOnce((_url, options: RequestInit) => {
      const accepted = (options.headers as Record<string, string>).Accept === accept;
      return Promise.resolve(new Response(null, { status: accepted ? 302 : 415, headers: { location: "https://storage.example.invalid/file" } }));
    }).mockResolvedValueOnce(new Response("downloaded bytes"));
    vi.stubGlobal("fetch", fetch);
    try {
      const api = publication.createGitHubApi("fixture-token");
      await expect(api.bytes(`/repos/owner/repo${path}`)).resolves.toEqual(Buffer.from("downloaded bytes"));
      expect(fetch.mock.calls[0][1].headers).toMatchObject({ Accept: accept, Authorization: "Bearer fixture-token" });
      expect(fetch.mock.calls[1][1].headers).toBeUndefined();
    } finally { vi.unstubAllGlobals(); }
  });

  it("publishes exact candidate files, then repeats without mutations", async () => {
    const fixture = apiFixture();
    await publish(fixture);
    expect(fixture.state.release).toMatchObject({ draft: false, prerelease: true, tag_name: tag });
    expect(fixture.state.release!.assets.map(a => a.name).sort()).toEqual(["main.js", "manifest.json", "styles.css"]);
    expect(fixture.api.json.mock.calls.at(-1)?.[2]).toMatchObject({ draft: false, make_latest: "false" });
    const mutations = fixture.state.mutations.length;
    await publish(fixture);
    expect(fixture.state.mutations).toHaveLength(mutations);
  });

  it("promotes stable with unchanged JavaScript and stylesheet and a stable manifest", async () => {
    const fixture = apiFixture();
    await publish(fixture, { tag: "1.2.3" });
    expect(fixture.state.release).toMatchObject({ prerelease: false, tag_name: "1.2.3" });
    const file = (name: string) => fixture.state.bytes.get(fixture.state.release!.assets.find(a => a.name === name)!.id)!;
    expect(tooling.sha256(file("main.js"))).toBe((metadata.files as Record<string, string>)["main.js"]);
    expect(tooling.sha256(file("styles.css"))).toBe((metadata.files as Record<string, string>)["styles.css"]);
    expect(JSON.parse(file("manifest.json").toString()).version).toBe("1.2.3");
    expect(fixture.api.json.mock.calls.at(-1)?.[2]).toMatchObject({ make_latest: "true" });
  });

  it.each(["workflow", "event", "tag", "commit", "attempt", "repository", "failed", "checks", "expired", "artifact", "digest", "missing", "step"])("rejects %s evidence before mutation", async kind => {
    const fixture = apiFixture();
    if (kind === "workflow") fixture.run.workflow_id = 8;
    if (kind === "event") fixture.run.event = "pull_request";
    if (kind === "tag") fixture.run.head_branch = "dev";
    if (kind === "commit") fixture.run.head_sha = "0".repeat(40);
    if (kind === "attempt") fixture.run.run_attempt = 1;
    if (kind === "repository") fixture.run.repository.full_name = "other/repo";
    if (kind === "failed") fixture.run.conclusion = "failure";
    if (kind === "checks") fixture.jobs[1].conclusion = "skipped";
    if (kind === "step") fixture.jobs[1].steps.pop();
    if (kind === "expired") fixture.artifact.expired = true;
    if (kind === "artifact") fixture.artifact.workflow_run.id = 124;
    if (kind === "digest") fixture.artifact.digest = `sha256:${"0".repeat(64)}`;
    if (kind === "missing") {
      const request = fixture.api.json.getMockImplementation()!;
      fixture.api.json.mockImplementation(async (method, path, body) => {
        if (path.endsWith("/artifacts/456")) throw Object.assign(new Error("Artifact missing"), { status: 404 });
        return request(method, path, body);
      });
    }
    await expect(publish(fixture)).rejects.toThrow();
    expect(fixture.state.mutations).toEqual([]);
  });

  it("rejects an untrusted dispatch ref and a development destination", async () => {
    const fixture = apiFixture();
    await expect(publication.publishInstallation({ inputs, context: { ...context, ref: "refs/heads/dev" }, api: fixture.api, repository: root, workDirectory: root })).rejects.toThrow();
    await expect(publish(fixture, { tag: "1.2.3-dev.1", sourceTag: "1.2.3-dev.1" })).rejects.toThrow();
    expect(fixture.state.mutations).toEqual([]);
  });

  it("resumes an interrupted draft without replacing existing assets", async () => {
    const fixture = apiFixture();
    const upload = fixture.api.upload.getMockImplementation()!;
    fixture.api.upload.mockImplementationOnce(upload).mockRejectedValueOnce(new Error("Interrupted upload"));
    await expect(publish(fixture)).rejects.toThrow("Interrupted upload");
    expect(fixture.state.release!.draft).toBe(true);
    const firstId = fixture.state.release!.assets[0].id;
    await publish(fixture);
    expect(fixture.state.release!.draft).toBe(false);
    expect(fixture.state.release!.assets[0].id).toBe(firstId);
  });

  it("preserves conflicting existing published assets", async () => {
    const fixture = apiFixture();
    await publish(fixture);
    fixture.state.bytes.set(fixture.state.release!.assets[0].id, Buffer.from("changed"));
    const mutations = fixture.state.mutations.length;
    await expect(publish(fixture)).rejects.toThrow();
    expect(fixture.state.mutations).toHaveLength(mutations);
  });

  it("rejects an unsafe archive before writing outside the artifact directory", async () => {
    const path = join(root, "unsafe.zip");
    execFileSync("python3", ["-c", 'import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],"w") as z: z.writestr("../escaped", "bad")', path]);
    const fixture = apiFixture();
    const unsafe = await readFile(path);
    fixture.artifact.digest = `sha256:${tooling.sha256(unsafe)}`;
    fixture.api.bytes.mockResolvedValue(unsafe);
    await expect(publish(fixture)).rejects.toThrow();
    expect(fixture.state.mutations).toEqual([]);
    await expect(readFile(join(root, "escaped"))).rejects.toThrow();
  });

  it.each(["schemaVersion", "repository", "runAttempt", "lockfileHash", "files"])("rejects corrupted %s metadata before mutation", async field => {
    const path = join(root, `bad-${field}.zip`);
    execFileSync("python3", ["-c", 'import zipfile,sys,json\nwith zipfile.ZipFile(sys.argv[1]) as src, zipfile.ZipFile(sys.argv[2],"w") as dst:\n for item in src.infolist():\n  data=src.read(item)\n  if item.filename=="build-info.json":\n   info=json.loads(data); info[sys.argv[3]]="corrupted"; data=json.dumps(info)\n  dst.writestr(item,data)', join(root, "artifact.zip"), path, field]);
    const fixture = apiFixture();
    const corrupted = await readFile(path);
    fixture.artifact.digest = `sha256:${tooling.sha256(corrupted)}`;
    fixture.api.bytes.mockResolvedValue(corrupted);
    await expect(publish(fixture)).rejects.toThrow();
    expect(fixture.state.mutations).toEqual([]);
  });

  it("rejects a corrupt installation file even when the archive digest is valid", async () => {
    const path = join(root, "corrupt-file.zip");
    execFileSync("python3", ["-c", 'import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1]) as src, zipfile.ZipFile(sys.argv[2],"w") as dst:\n for item in src.infolist(): dst.writestr(item,b"changed" if item.filename=="install/main.js" else src.read(item))', join(root, "artifact.zip"), path]);
    const fixture = apiFixture();
    const corrupted = await readFile(path);
    fixture.artifact.digest = `sha256:${tooling.sha256(corrupted)}`;
    fixture.api.bytes.mockResolvedValue(corrupted);
    await expect(publish(fixture)).rejects.toThrow();
    expect(fixture.state.mutations).toEqual([]);
  });

  it("rejects an incomplete published release without repair", async () => {
    const fixture = apiFixture();
    await publish(fixture);
    fixture.state.release!.assets.pop();
    const count = fixture.state.mutations.length;
    await expect(publish(fixture)).rejects.toThrow("incomplete");
    expect(fixture.state.mutations).toHaveLength(count);
  });

  it.each(["source", "channel", "status"])("refuses a draft whose %s changes before publication", async kind => {
    const fixture = apiFixture();
    const request = fixture.api.json.getMockImplementation()!;
    fixture.api.json.mockImplementation(async (method, path, body) => {
      const result = await request(method, path, body);
      if (method === "GET" && path.endsWith("/releases/10")) {
        const draft = fixture.state.release!;
        if (kind === "source") draft.body = "Changed source";
        if (kind === "channel") draft.prerelease = false;
        if (kind === "status") draft.draft = false;
      }
      return result;
    });
    await expect(publish(fixture)).rejects.toThrow("Draft source, channel, or status changed");
    expect(fixture.state.mutations.some(mutation => mutation.startsWith("PATCH"))).toBe(false);
  });

  it("resolves annotated remote tags and rejects a source moved after verification", async () => {
    const fixture = apiFixture();
    const request = fixture.api.json.getMockImplementation()!;
    fixture.api.json.mockImplementation(async (method, path, body) => {
      if (path.includes("/git/ref/tags/")) return { object: { type: "tag", sha: "a".repeat(40) } };
      if (path.includes("/git/tags/")) return { object: { type: "commit", sha: commit } };
      return request(method, path, body);
    });
    await publish(fixture);
    fixture.api.json.mockImplementation(async (method, path, body) => {
      if (path.includes("/git/ref/tags/")) return { object: { type: "commit", sha: "0".repeat(40) } };
      return request(method, path, body);
    });
    const count = fixture.state.mutations.length;
    await expect(publish(fixture)).rejects.toThrow();
    expect(fixture.state.mutations).toHaveLength(count);
  });
});
