/**
 * The frontend and main.py agree on method names: every bridge method the
 * frontend calls is in main.py's BRIDGE_METHODS allowlist (anything else is
 * refused with "Unknown action"), and every callable() is a Plugin method.
 */
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const MAIN_PY = readFileSync(join(ROOT, "main.py"), "utf8");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === "test" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [path] : [];
  });
}
const SOURCES = sourceFiles(join(ROOT, "src")).map((path) => ({ path, text: readFileSync(path, "utf8") }));

/** First string argument of every call to one of `fns`, e.g. bridge<Mod[]>("mods", ...). */
function literalFirstArgs(fns: string[]): Map<string, string[]> {
  const re = new RegExp(`\\b(?:${fns.join("|")})\\b(?:<[^(]*>)?\\(\\s*"([A-Za-z0-9_]+)"`, "g");
  const found = new Map<string, string[]>();
  for (const { path, text } of SOURCES) {
    for (const m of text.matchAll(re)) found.set(m[1], [...(found.get(m[1]) ?? []), path.slice(ROOT.length + 1)]);
  }
  return found;
}

function bridgeMethods(): Set<string> {
  const block = MAIN_PY.match(/^BRIDGE_METHODS\s*=\s*\{([\s\S]*?)^\}/m);
  if (!block) throw new Error("BRIDGE_METHODS = { ... } not found in main.py");
  return new Set([...block[1].matchAll(/"([A-Za-z0-9_]+)"\s*:/g)].map((m) => m[1]));
}

describe("frontend/backend contract", () => {
  it("finds main.py's BRIDGE_METHODS", () => {
    expect(bridgeMethods().size).toBeGreaterThan(20);
  });

  it("every bridge()/startInstall() method is in BRIDGE_METHODS", () => {
    const used = literalFirstArgs(["bridge", "startInstall"]);
    expect(used.size).toBeGreaterThan(20);
    const allowed = bridgeMethods();
    const missing = [...used].filter(([m]) => !allowed.has(m)).map(([m, files]) => `${m} (${files.join(", ")})`);
    expect(missing).toEqual([]);
  });

  it("bridge() and startInstall() are only called with string literals", () => {
    // Otherwise the check above can't see the method name.
    const dynamic = SOURCES.flatMap(({ text }) =>
      [...text.matchAll(/\b(?:bridge|startInstall)\b(?:<[^(]*>)?\(\s*([^"\s)][^,)]*)/g)]
        .map((m) => m[0]))
      // the helpers' own definitions, and startInstall passing its argument on
      .filter((s) => !["bridge<T>(method: string", "startInstall(method: string", "bridge<Task>(method"].includes(s));
    expect(dynamic).toEqual([]);
  });

  it("every callable() is a method of main.py's Plugin", () => {
    const names = literalFirstArgs(["callable"]);
    expect([...names.keys()].sort()).toEqual(["call", "job_status", "list_games", "start_job"]);
    for (const name of names.keys()) expect(MAIN_PY).toMatch(new RegExp(`async def ${name}\\(self`));
  });
});
