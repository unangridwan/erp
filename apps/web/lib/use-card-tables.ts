"use client";

import { useEffect } from "react";

/** Tabel yang bukan daftar data (input baris, matriks, laporan) tetap tabel di ponsel. */
const SKIP = ["lines", "mpp-lines", "perm-table", "budget-grid", "attendance-matrix", "no-cards"];

/**
 * Daftar sebagai kartu di layar sempit: setiap sel diberi `data-label` dari judul kolomnya dan tabel diberi kelas
 * `data-cards` (bukan `cards`: nama itu sudah dipakai grid kartu global sehingga tabel desktop ikut rusak); CSS
 * (`@media (max-width: 640px)`) menyusun tiap baris jadi kartu "Label: nilai". Berlaku otomatis untuk semua tabel
 * ≥ 3 kolom di halaman (termasuk tabel yang dibuat halaman sendiri) dan baris yang dimuat belakangan.
 */
export function useCardTables() {
  useEffect(() => {
    const el = document.body;
    let frame = 0;
    const label = () => {
      frame = 0;
      for (const table of el.querySelectorAll<HTMLTableElement>("table")) {
        if (SKIP.some((c) => table.classList.contains(c))) continue;
        const headRow = table.tHead?.rows[table.tHead.rows.length - 1];
        if (!headRow) continue;
        const headers: string[] = [];
        for (const th of headRow.cells) {
          // Judul kolom tanpa ikon urut (↕ ▲ ▼).
          const text = (th.getAttribute("aria-label") ?? th.textContent ?? "")
            .replace(/[↑↓↕▲▼⇅]/g, "")
            .trim();
          for (let i = 0; i < th.colSpan; i++) headers.push(text);
        }
        if (headers.length < 3) continue;
        if (!table.classList.contains("data-cards")) {
          table.classList.add("data-cards");
          // display:block di CSS kartu menghapus semantik tabel di sebagian browser; pertahankan lewat role ARIA.
          table.setAttribute("role", "table");
          for (const section of [table.tHead, ...table.tBodies]) section?.setAttribute("role", "rowgroup");
          headRow.setAttribute("role", "row");
          for (const th of headRow.cells) th.setAttribute("role", "columnheader");
        }
        for (const body of table.tBodies)
          for (const row of body.rows) {
            const key = headers.join("|");
            if (row.dataset.cardsLabeled === key) continue;
            row.dataset.cardsLabeled = key;
            row.setAttribute("role", "row");
            let col = 0;
            let titled = false;
            for (const cell of row.cells) {
              const text = cell.colSpan > 1 ? "" : (headers[col] ?? "");
              cell.setAttribute("data-label", text);
              if (!cell.hasAttribute("role")) cell.setAttribute("role", "cell");
              cell.classList.toggle("card-title", !titled && !!text && cell.colSpan === 1);
              if (text && cell.colSpan === 1) titled = true;
              col += cell.colSpan;
            }
          }
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(label);
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(el, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
}
