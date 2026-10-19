import { describe, expect, it } from "vitest";
import { compileScope, previewScope, sanitizeScopeSettings, type ScopeSettings } from "../../packages/plugin/src/sync-scope.js";

const scope = (patterns: string, mode: ScopeSettings["mode"] = "exclude", skipJunk = true) =>
  compileScope({ mode, patterns, skipJunk }).isInScope;

describe("sync scope", () => {
  it("syncs everything by default", () => {
    const inScope = scope("");
    expect(inScope("notes/a.md")).toBe(true);
    expect(inScope("a.png")).toBe(true);
  });

  it("excludes a folder and everything beneath it", () => {
    const inScope = scope("code/");
    expect(inScope("code/app/main.py")).toBe(false);
    expect(inScope("notes/a.md")).toBe(true);
    expect(inScope("notes/code/a.md")).toBe(false);
  });

  it("anchors patterns with a leading or inner slash", () => {
    expect(scope("/code/")("notes/code/a.md")).toBe(true);
    expect(scope("/code/")("code/a.md")).toBe(false);
    expect(scope("notes/tmp")("notes/tmp/a.md")).toBe(false);
    expect(scope("notes/tmp")("x/notes/tmp/a.md")).toBe(true);
  });

  it("supports *, ?, ** and comments", () => {
    const inScope = scope("# comment\n\n*.log\nbuild-?/\na/**/z.md");
    expect(inScope("x/y/run.log")).toBe(false);
    expect(inScope("build-1/o.md")).toBe(false);
    expect(inScope("build-10/o.md")).toBe(true);
    expect(inScope("a/z.md")).toBe(false);
    expect(inScope("a/b/c/z.md")).toBe(false);
    expect(inScope("a/b/c/y.md")).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(scope("Code/")("code/a.md")).toBe(false);
  });

  it("re-includes a file but not inside an excluded directory", () => {
    const inScope = scope("*.log\n!keep.log\nsecret/\n!secret/a.md");
    expect(inScope("keep.log")).toBe(true);
    expect(inScope("other.log")).toBe(false);
    expect(inScope("secret/a.md")).toBe(false);
  });

  it("only selected syncs just matching paths", () => {
    const inScope = scope("*.md\nAttachments/", "only");
    expect(inScope("a/b.md")).toBe(true);
    expect(inScope("Attachments/x.png")).toBe(true);
    expect(inScope("a/b.py")).toBe(false);
  });

  it("only selected negation carves out", () => {
    const inScope = scope("Projects/\n!Projects/private/", "only");
    expect(inScope("Projects/a.md")).toBe(true);
    expect(inScope("Projects/private/a.md")).toBe(false);
  });

  it("only selected with an empty list syncs nothing", () => {
    expect(scope("", "only")("a.md")).toBe(false);
  });

  it("skips common junk in both modes", () => {
    for (const mode of ["exclude", "only"] as const) {
      const inScope = scope(mode === "only" ? "*" : "", mode);
      expect(inScope("scripts/venv/lib/x.py")).toBe(false);
      expect(inScope("pkg/node_modules/a/index.js")).toBe(false);
      expect(inScope("pkg/__pycache__/a.cpython.pyc")).toBe(false);
      expect(inScope("pkg/a.pyc")).toBe(false);
      expect(inScope("Thumbs.db")).toBe(false);
      expect(inScope("notes/a.md")).toBe(true);
    }
  });

  it("junk toggle removes only the built-in list", () => {
    const inScope = scope("code/", "exclude", false);
    expect(inScope("scripts/venv/x.py")).toBe(true);
    expect(inScope("code/x.py")).toBe(false);
  });

  it("keeps dot-prefixed parts out in every configuration", () => {
    expect(scope("", "exclude", false)(".obsidian/app.json")).toBe(false);
    expect(scope("*", "only", false)("a/.hidden/b.md")).toBe(false);
  });

  it("previews counts and samples", () => {
    const preview = previewScope(compileScope({ mode: "exclude", patterns: "code/", skipJunk: true }).isInScope,
      ["a.md", "code/a.py", "code/b.py", "venv/x"], 1);
    expect(preview).toEqual({ inScope: 1, outScope: 3, outSamples: ["code/a.py"] });
  });

  it("sanitizes stored settings", () => {
    expect(sanitizeScopeSettings(undefined)).toEqual({ mode: "exclude", patterns: "", skipJunk: true });
    expect(sanitizeScopeSettings({ mode: "bad", patterns: 5, skipJunk: "x" })).toEqual({ mode: "exclude", patterns: "", skipJunk: true });
    expect(sanitizeScopeSettings({ mode: "only", patterns: "*.md", skipJunk: false })).toEqual({ mode: "only", patterns: "*.md", skipJunk: false });
  });
});
