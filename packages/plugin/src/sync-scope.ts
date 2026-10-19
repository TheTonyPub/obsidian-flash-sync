export type ScopeMode = "exclude" | "only";

export interface ScopeSettings {
  mode: ScopeMode;
  patterns: string;
  skipJunk: boolean;
}

export const DEFAULT_SCOPE: ScopeSettings = { mode: "exclude", patterns: "", skipJunk: true };

const JUNK_PARTS = new Set(["venv", ".venv", "node_modules", "__pycache__", ".git", ".idea", ".vscode", ".ds_store", "thumbs.db"]);

interface Rule {
  excludes: boolean;
  dirOnly: boolean;
  anchored: boolean;
  regex: RegExp;
}

export function sanitizeScopeSettings(value: unknown): ScopeSettings {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    mode: raw.mode === "only" ? "only" : "exclude",
    patterns: typeof raw.patterns === "string" ? raw.patterns : "",
    skipJunk: typeof raw.skipJunk === "boolean" ? raw.skipJunk : true,
  };
}

function globToRegex(glob: string): string {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]!;
    if (char === "*") {
      if (glob[i + 1] === "*") {
        const leading = i === 0 || glob[i - 1] === "/";
        if (leading && glob[i + 2] === "/") { out += "(?:.*/)?"; i += 2; }
        else if (leading && i + 2 === glob.length) { out += ".*"; i += 1; }
        else { out += "[^/]*"; i += 1; }
      } else out += "[^/]*";
    } else if (char === "?") out += "[^/]";
    else out += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return out;
}

function parseRules(patterns: string, mode: ScopeMode): Rule[] {
  const rules: Rule[] = [];
  for (const rawLine of patterns.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const negate = line.startsWith("!");
    if (negate) line = line.slice(1);
    const dirOnly = line.endsWith("/");
    if (dirOnly) line = line.slice(0, -1);
    let anchored = line.includes("/");
    if (line.startsWith("/")) line = line.slice(1);
    if (!line) continue;
    if (line.endsWith("/**")) anchored = true;
    rules.push({ excludes: mode === "exclude" ? !negate : negate, dirOnly, anchored, regex: new RegExp(`^${globToRegex(line)}$`, "i") });
  }
  return rules;
}

function hasJunkPart(parts: string[]): boolean {
  if (parts.some((part) => JUNK_PARTS.has(part.toLowerCase()))) return true;
  return parts[parts.length - 1]!.toLowerCase().endsWith(".pyc");
}

export function compileScope(settings: ScopeSettings): { isInScope(path: string): boolean } {
  const rules = parseRules(settings.patterns, settings.mode);
  const defaultIn = settings.mode === "exclude";
  return {
    isInScope(path: string): boolean {
      const parts = path.split("/");
      if (parts.some((part) => part.startsWith("."))) return false;
      if (settings.skipJunk && hasJunkPart(parts)) return false;
      let state = defaultIn;
      for (let i = 0; i < parts.length; i++) {
        const isDir = i < parts.length - 1;
        const prefix = parts.slice(0, i + 1).join("/");
        const name = parts[i]!;
        let matched: Rule | undefined;
        for (const rule of rules) {
          if (rule.dirOnly && !isDir) continue;
          if (rule.regex.test(rule.anchored ? prefix : name)) matched = rule;
        }
        if (!matched) continue;
        state = !matched.excludes;
        if (!state && isDir) return false;
      }
      return state;
    },
  };
}

export function previewScope(isInScope: (path: string) => boolean, paths: string[], sampleLimit = 5):
  { inScope: number; outScope: number; outSamples: string[] } {
  const outSamples: string[] = [];
  let inScope = 0;
  for (const path of paths) {
    if (isInScope(path)) inScope++;
    else if (outSamples.length < sampleLimit) outSamples.push(path);
  }
  return { inScope, outScope: paths.length - inScope, outSamples };
}
