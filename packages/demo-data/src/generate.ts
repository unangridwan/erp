#!/usr/bin/env node
/** `pnpm demo:excel` — bangkitkan workbook data simulasi & file siap impor. */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeImportFiles } from "./import-files.js";
import { buildModel } from "./model.js";
import { writeWorkbook } from "./sheets.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const out = resolve(process.argv[2] ?? join(root, "demo/didin-putra-agro"));

const model = buildModel();
await rm(join(out, "impor"), { recursive: true, force: true });
await mkdir(out, { recursive: true });
const workbook = join(out, "Data-Simulasi-PT-Didin-Putra-Agro.xlsx");
await writeWorkbook(model, workbook);
const files = await writeImportFiles(model, join(out, "impor"));
await writeFile(
  join(out, "impor", "DAFTAR.md"),
  [
    "# File siap impor",
    "",
    "Pilih perusahaan aktif sesuai nama folder (GRUP = perusahaan mana pun), lalu unggah berurutan.",
    "",
    "| File | Menu ERP |",
    "|---|---|",
    ...files.map((f) => `| ${f.file} | ${f.menu} |`),
    "",
  ].join("\n"),
);
const counts = Object.entries(model)
  .map(([k, v]) => `${k}: ${v.length}`)
  .join(", ");
console.log(`Workbook: ${workbook}\nFile impor: ${files.length}\n${counts}`);
