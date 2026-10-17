/** Pemetaan kolom CSV mutasi rekening bank (format tiap bank berbeda). */
export interface StatementMapping {
  date: string;
  description: string;
  /** Satu kolom jumlah bertanda (masuk +, keluar −) … */
  amount?: string;
  /** … atau dua kolom terpisah. */
  debit?: string;
  credit?: string;
  partner?: string;
  dateFormat: "DD/MM/YYYY" | "YYYY-MM-DD" | "MM/DD/YYYY" | "DD-MM-YYYY" | "DD/MM/YY";
  /** Pemisah desimal: "," (format Indonesia 1.234,56) atau "." (1,234.56). */
  decimal: "," | ".";
  /** Untuk dua kolom: kolom mana yang berarti uang keluar. Biasanya "debit" (sudut pandang rekening bank). */
  outflow?: "debit" | "credit";
}

export interface StatementLineInput {
  date: string;
  paymentRef: string;
  partnerName: string | null;
  amount: string;
}

/**
 * Urai angka dari mutasi bank: "1.234.567,89", "-1,234.50", "(1.000)", "1.000,00 CR", "500.000 DB".
 * Mengembalikan string desimal bertanda, atau null bila kosong/tidak valid.
 */
export function parseBankAmount(raw: string | undefined, decimal: "," | "."): string | null {
  if (raw === undefined) return null;
  let s = raw.trim().toUpperCase().replace(/\s+/g, "").replace(/^RP/, "");
  if (!s) return null;
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith("DB") || s.endsWith("DR") || s.endsWith("D")) {
    negative = true;
    s = s.replace(/(DB|DR|D)$/, "");
  } else if (s.endsWith("CR") || s.endsWith("K")) {
    s = s.replace(/(CR|K)$/, "");
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  const thousands = decimal === "," ? "." : ",";
  s = s.split(thousands).join("");
  if (decimal === ",") s = s.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [int, frac = ""] = s.split(".");
  const normalized = `${int!.replace(/^0+(?=\d)/, "")}.${(frac + "00").slice(0, 2)}`;
  return negative && Number(normalized) !== 0 ? `-${normalized}` : normalized;
}

export function parseBankDate(
  raw: string | undefined,
  format: StatementMapping["dateFormat"],
): string | null {
  const s = raw?.trim();
  if (!s) return null;
  const parts = s.split(/[/\-. ]/).filter(Boolean);
  let y: number, m: number, d: number;
  switch (format) {
    case "YYYY-MM-DD":
      [y, m, d] = parts.map(Number) as [number, number, number];
      break;
    case "MM/DD/YYYY":
      [m, d, y] = parts.map(Number) as [number, number, number];
      break;
    case "DD/MM/YY":
      [d, m, y] = parts.map(Number) as [number, number, number];
      y += y < 70 ? 2000 : 1900;
      break;
    default:
      [d, m, y] = parts.map(Number) as [number, number, number];
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    !y ||
    !m ||
    !d ||
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  )
    return null;
  return date.toISOString().slice(0, 10);
}

/** Ubah baris CSV mentah menjadi baris mutasi; baris saldo/kosong (jumlah 0) dilewati. */
export function mapStatementRows(rows: Record<string, string>[], mapping: StatementMapping) {
  const lines: StatementLineInput[] = [];
  const errors: { row: number; message: string }[] = [];
  rows.forEach((row, i) => {
    const rowNo = i + 2;
    const date = parseBankDate(row[mapping.date], mapping.dateFormat);
    if (!date)
      return errors.push({ row: rowNo, message: `Tanggal tidak valid: "${row[mapping.date] ?? ""}"` });
    let amount: string | null;
    if (mapping.amount) {
      amount = parseBankAmount(row[mapping.amount], mapping.decimal);
    } else {
      const debit = parseBankAmount(row[mapping.debit ?? ""], mapping.decimal);
      const credit = parseBankAmount(row[mapping.credit ?? ""], mapping.decimal);
      const outflowIsDebit = (mapping.outflow ?? "debit") === "debit";
      const out = Math.abs(Number((outflowIsDebit ? debit : credit) ?? 0));
      const inn = Math.abs(Number((outflowIsDebit ? credit : debit) ?? 0));
      amount = (inn - out).toFixed(2);
    }
    if (amount === null) return errors.push({ row: rowNo, message: "Jumlah tidak valid" });
    if (Number(amount) === 0) return;
    lines.push({
      date,
      paymentRef: (row[mapping.description] ?? "").trim() || "-",
      partnerName: mapping.partner ? row[mapping.partner]?.trim() || null : null,
      amount,
    });
  });
  return { lines, errors };
}
