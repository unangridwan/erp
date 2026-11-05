"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { ask } from "../components/feedback";

/**
 * Lindungi perubahan yang belum disimpan: peringatan saat menutup/memuat ulang tab (`beforeunload`) dan dialog
 * konfirmasi saat mengeklik tautan di dalam aplikasi.
 */
export function useDirtyGuard(dirty: boolean, message?: string) {
  const router = useRouter();
  const ref = useRef(dirty);
  ref.current = dirty;
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
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [router, message]);
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
