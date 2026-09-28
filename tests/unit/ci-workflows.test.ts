import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const { load } = createRequire(import.meta.url)("js-yaml");
const readWorkflow = async (name: string) => load(await readFile(new URL(`../../.github/workflows/${name}`, import.meta.url), "utf8"));

describe("release workflow boundaries", () => {
  it("gates one compilation behind tag validation and retains the full checks", async () => {
    const ci = await readWorkflow("ci.yml");
    expect(ci.on.push.branches).toContain("release/*");
    expect(ci.jobs.validate.steps.some((step: { run?: string }) => step.run?.includes("plugin-release.mjs validate"))).toBe(true);
    expect(ci.jobs.checks.needs).toBe("validate");
    expect(ci.jobs.checks.if).toContain("!= 'stable'");
    const commands = ci.jobs.checks.steps.map((step: { run?: string }) => step.run ?? "").join("\n");
    expect(commands.match(/npm run build:plugin/g)).toHaveLength(1);
    for (const command of ["typecheck", "lint", "test:coverage", "test:server-cli-bundle", "test:integration", "test:simulation", "test:coverage:aggregate"])
      expect(commands).toContain(`npm run ${command}`);
    expect(commands).toContain("NATS_TEST_DOCKER=1");
    expect(commands).toContain("S3_TEST_DOCKER=1");
    const upload = ci.jobs.checks.steps.find((step: { name: string }) => step.name === "upload installation artifact");
    expect(upload.if).not.toContain("always()");
    expect(upload.with.name).toContain("github.run_attempt");
    expect(upload.with["retention-days"]).toBe(90);
    expect(JSON.stringify(ci)).not.toContain("gh release create");
    expect(ci.permissions.contents).toBe("read");
  });

  it("publishes only on explicit dispatch from trusted code without npm or compilation", async () => {
    const workflow = await readWorkflow("plugin-publish.yml");
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    expect(Object.keys(workflow.on.workflow_dispatch.inputs).sort()).toEqual(["artifact_id", "build_run_attempt", "build_run_id", "source_tag", "tag"]);
    expect(workflow.jobs.publish.if).toContain("default_branch");
    expect(workflow.jobs.publish.permissions).toEqual({ actions: "read", contents: "write" });
    expect(workflow.concurrency["cancel-in-progress"]).toBe(false);
    const commands = workflow.jobs.publish.steps.map((step: { run?: string }) => step.run ?? "").join("\n");
    expect(commands).not.toMatch(/npm|build:plugin/);
    for (const step of workflow.jobs.publish.steps) if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
  });
});
