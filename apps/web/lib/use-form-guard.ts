"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ask } from "../components/feedback";

/**
 * Lindungi perubahan yang belum disimpan: peringatan saat menutup/memuat ulang tab (`beforeunload`) dan dialog
 * konfirmasi saat mengeklik tautan di dalam aplikasi.
 */
export function useDirtyGuard(dirty: boolean, message?: string) {
  const router = useRouter();
  const ref = useRef(dirty);
  ref.current = dirty;
  const guarded = useRef(false);
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!ref.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      if (!ref.current || e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      void ask({
        title: document.documentElement.lang === "en" ? "Unsaved changes" : "Perubahan belum disimpan",
        message:
          message ??
          (document.documentElement.lang === "en"
            ? "Leave this page and discard your changes?"
            : "Tinggalkan halaman ini dan buang perubahan?"),
        confirmLabel: document.documentElement.lang === "en" ? "Discard & leave" : "Buang & tinggalkan",
        danger: true,
      }).then((ok) => {
        if (!ok) return;
        ref.current = false;
        router.push(url.pathname + url.search + url.hash);
      });
    };
    // Tombol Kembali browser: saat form kotor, sisipkan satu entri riwayat penjaga. Kembali → entri itu terlepas,
    // kita tanya dulu; batal → pasang lagi penjaganya, setuju → lanjut mundur ke halaman sebelumnya.
    const onPop = () => {
      if (!guarded.current) return;
      guarded.current = false;
      if (!ref.current) {
        window.history.back();
        return;
      }
      void ask({
        title: document.documentElement.lang === "en" ? "Unsaved changes" : "Perubahan belum disimpan",
        message:
          message ??
          (document.documentElement.lang === "en"
            ? "Leave this page and discard your changes?"
            : "Tinggalkan halaman ini dan buang perubahan?"),
        confirmLabel: document.documentElement.lang === "en" ? "Discard & leave" : "Buang & tinggalkan",
        danger: true,
      }).then((ok) => {
        if (ok) {
          ref.current = false;
          window.history.back();
        } else {
          window.history.pushState({ dirtyGuard: true }, "", window.location.href);
          guarded.current = true;
        }
      });
    };
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("popstate", onPop);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("click", onClick, true);
    };
  }, [router, message]);

  useEffect(() => {
    if (dirty && !guarded.current) {
      window.history.pushState({ dirtyGuard: true }, "", window.location.href);
      guarded.current = true;
    }
  }, [dirty]);
}

/**
 * Form dokumen (pesanan, faktur, transfer, …): kotor bila nilai form berbeda dari saat terakhir dimuat/disimpan.
 * `loadedKey` berubah tiap kali dokumen (ulang) dimuat; saat itu nilai form sekarang menjadi patokan baru.
 * Memasang `useDirtyGuard` dan mengembalikan status kotor.
 */
export function useFormSnapshot(values: unknown, loadedKey: unknown, enabled = true) {
  const current = JSON.stringify(values);
  const currentRef = useRef(current);
  currentRef.current = current;
  const [baseline, setBaseline] = useState<string | null>(null);
  // Nilai bawaan yang diisi otomatis setelah dimuat (jurnal, gudang, …) bukan perubahan pengguna: kotor hanya bila
  // pengguna benar-benar mengetik/memilih sesuatu sejak patokan diambil.
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    setBaseline(currentRef.current);
    setTouched(false);
    // Ditunda: setState sinkron di dalam event input (sebelum onChange React) membuat input terkontrol kembali ke
    // nilai lama dan ketikan hilang.
    let marked = false;
    const onInput = () => {
      if (marked) return;
      marked = true;
      setTimeout(() => setTouched(true), 0);
    };
    document.addEventListener("input", onInput, true);
    document.addEventListener("change", onInput, true);
    return () => {
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("change", onInput, true);
    };
  }, [loadedKey]);
  const dirty = enabled && touched && baseline !== null && baseline !== current;
  useDirtyGuard(dirty);
  return dirty;
}

/** Ctrl/⌘+S menjalankan `onSave` (mis. submit form) bila `enabled`. */
export function useSaveShortcut(onSave: () => void, enabled = true) {
  const ref = useRef(onSave);
  ref.current = onSave;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        ref.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

/** Fokus & gulir ke field pertama yang bermasalah di dalam `root` (berdasarkan nama atau `aria-invalid`). */
export function focusFirstError(root: HTMLElement | null, names: string[]) {
  if (!root) return;
  const byName = names
    .map((n) =>
      root.querySelector<HTMLElement>(
        `[name="${CSS.escape(n)}"], [data-field="${CSS.escape(n)}"] input, [data-field="${CSS.escape(n)}"] select, [data-field="${CSS.escape(n)}"] textarea`,
      ),
    )
    .find(Boolean);
  const el = byName ?? root.querySelector<HTMLElement>('[aria-invalid="true"]');
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.focus({ preventScroll: true });
}
