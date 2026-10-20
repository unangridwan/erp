import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "../../..");

/** String literal JS berikut potongan lanjutan `+ "..."` / `+ \`...\``; template `${…}` dinormalkan menjadi `{}`. */
const LITERAL = String.raw`(?:"(?:[^"\\]|\\.)*"|\x60(?:[^\x60\\]|\\.)*\x60)`;
const MESSAGE = String.raw`(${LITERAL}(?:\s*\+\s*${LITERAL})*)`;
const THROW = new RegExp(
  String.raw`(?:BadRequest|NotFound|Forbidden|Conflict|Unauthorized|UnprocessableEntity|PayloadTooLarge|ServiceUnavailable|Gone)Exception\(\s*${MESSAGE}`,
  "g",
);
/** `fieldError(path, pesan)`: argumen pertama (path) dilewati. */
const FIELD = new RegExp(String.raw`fieldError\(\s*(?:${LITERAL}|[^,()"\x60]+?)\s*,\s*${MESSAGE}`, "g");
const ZOD = new RegExp(String.raw`(?:message|error):\s*(${LITERAL})`, "g");
const ZOD_ARG = new RegExp(
  String.raw`\.(?:min|max|regex|refine|length|email|url|uuid|date|int|positive|nonnegative)\([^)]*?(${LITERAL})\)`,
  "g",
);
const RAISE = /raise exception '((?:[^']|'')*)'/gi;

function unquote(expr: string) {
  return [...expr.matchAll(new RegExp(LITERAL, "g"))]
    .map(([s]) => s.slice(1, -1))
    .join("")
    .replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, "{}")
    .replace(/\\(["'\x60\\])/g, "$1");
}

function files(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, ext);
    return path.endsWith(ext) && !path.endsWith(".test.ts") ? [path] : [];
  });
}

/** Semua pesan error berbahasa Indonesia di kode (API, shared, trigger SQL) beserta lokasinya. */
export function scanErrorMessages(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const add = (message: string, where: string) => {
    if (!/[a-z]/i.test(message)) return;
    found.set(message, [...(found.get(message) ?? []), where]);
  };
  for (const dir of ["apps/api/src", "packages/shared/src", "packages/db/src"])
    for (const file of files(join(ROOT, dir), ".ts")) {
      const source = readFileSync(file, "utf8");
      const where = relative(ROOT, file);
      for (const m of source.matchAll(THROW)) add(unquote(m[1]!), where);
      for (const m of source.matchAll(FIELD)) add(unquote(m[1]!), where);
      if (dir === "packages/shared/src") {
        for (const m of source.matchAll(ZOD)) add(unquote(m[1]!), where);
        for (const m of source.matchAll(ZOD_ARG)) add(unquote(m[1]!), where);
      }
    }
  for (const file of files(join(ROOT, "packages/db/migrations"), ".sql")) {
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(RAISE))
      add(m[1]!.replace(/''/g, "'").replace(/%/g, "{}"), relative(ROOT, file));
  }
  return found;
}
