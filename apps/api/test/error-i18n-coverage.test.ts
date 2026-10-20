import { describe, expect, it } from "vitest";
import { MESSAGES_EN } from "../src/common/error-messages-en.js";
import { translateMessage } from "../src/common/error-i18n.js";
import { scanErrorMessages } from "./error-messages-scan.js";

describe("terjemahan pesan error", () => {
  it("setiap pesan error di kode (exception, fieldError, zod, trigger SQL) punya terjemahan Inggris", () => {
    const missing = [...scanErrorMessages()]
      .filter(([message]) => {
        const sample = message.replace(/\{\}/g, "X1");
        return translateMessage(sample) === sample;
      })
      .map(([message, where]) => `${message}  (${[...new Set(where)].join(", ")})`);
    // Tambahkan pesan baru ke src/common/error-messages-en.ts.
    expect(missing).toEqual([]);
  });

  it("template mengisi bagian dinamis sesuai urutan; jumlah placeholder sama", () => {
    expect(translateMessage("Stok Kopi di WH/Stok tidak cukup (tersedia 2, dibutuhkan 5)")).toBe(
      "Not enough Kopi in WH/Stok (2 available, 5 needed)",
    );
    expect(translateMessage("Entri jurnal tidak seimbang (debit 100.00, kredit 90.00, 2 baris)")).toBe(
      "The journal entry is not balanced (debit 100.00, credit 90.00, 2 lines)",
    );
    for (const [id, en] of Object.entries(MESSAGES_EN)) {
      const n = id.split("{}").length - 1;
      const used = new Set([...en.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1])));
      expect(
        [...used].every((i) => i < n),
        id,
      ).toBe(true);
      expect(used.size, id).toBe(n);
    }
  });
});
