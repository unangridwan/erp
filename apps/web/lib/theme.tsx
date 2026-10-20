"use client";

import { useEffect, useState } from "react";
import { useI18n } from "./i18n";

export type ThemeChoice = "light" | "dark" | "system";
const KEY = "erp.theme";

/**
 * Skrip kecil yang dijalankan di <head> sebelum halaman digambar, agar tema pilihan langsung berlaku tanpa kedip.
 * "system" (bawaan) tidak memasang atribut sehingga CSS mengikuti prefers-color-scheme.
 */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem("${KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

function read(): ThemeChoice {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

function apply(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Penyimpanan tidak tersedia (mode privat): tema tetap berlaku sampai halaman dimuat ulang.
  }
  window.dispatchEvent(new CustomEvent("erp-theme", { detail: choice }));
}

/** Tema pilihan pengguna (disimpan per peramban), disinkronkan antar komponen & tab. */
export function useTheme(): [ThemeChoice, (t: ThemeChoice) => void] {
  const [theme, setTheme] = useState<ThemeChoice>("system");
  useEffect(() => {
    setTheme(read());
    const sync = () => setTheme(read());
    window.addEventListener("erp-theme", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("erp-theme", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return [theme, apply];
}

export function useThemeLabels() {
  const { l } = useI18n();
  return {
    light: l("Terang", "Light"),
    dark: l("Gelap", "Dark"),
    system: l("Ikuti sistem", "System"),
  } satisfies Record<ThemeChoice, string>;
}

/** Pemilih tema ringkas (halaman masuk/daftar). */
export function ThemeSwitch() {
  const { l } = useI18n();
  const [theme, setTheme] = useTheme();
  const labels = useThemeLabels();
  return (
    <select
      aria-label={l("Tema", "Theme")}
      value={theme}
      onChange={(e) => setTheme(e.target.value as ThemeChoice)}
    >
      {(["system", "light", "dark"] as const).map((t) => (
        <option key={t} value={t}>
          {labels[t]}
        </option>
      ))}
    </select>
  );
}
