/** CSV RFC 4180: koma sebagai pemisah, kutip ganda untuk field berisi koma/kutip/baris baru. */

/** Urai teks CSV menjadi baris-baris objek berdasarkan header di baris pertama. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows = parseRows(text.replace(/^\uFEFF/, ""));
  const [header, ...body] = rows;
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return body
    .filter((r) => r.some((cell) => cell.trim() !== ""))
    .map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ""])));
}

function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (quoted) throw new Error("CSV tidak valid: tanda kutip tidak ditutup");
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Serialisasi baris ke CSV. Sel yang diawali = + - @ diberi awalan ' agar tidak dieksekusi
 * sebagai formula saat dibuka di spreadsheet (CSV injection).
 */
export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const cell = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    let s =
      value instanceof Date
        ? value.toISOString()
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return (
    [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n"
  );
}
