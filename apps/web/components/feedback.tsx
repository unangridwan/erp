"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useI18n } from "../lib/i18n";

/**
 * Umpan balik global: toast (pesan singkat yang hilang sendiri), dialog konfirmasi pengganti `confirm()` browser, dan
 * modal generik. API-nya imperatif (`toast.success(...)`, `await ask(...)`) agar bisa dipanggil dari mana saja;
 * tampilannya dirender oleh `<FeedbackHost />` di layout akar.
 */

export type ToastKind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  action?: { label: string; onClick: () => void };
}
interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Aksi berbahaya (hapus, batalkan): tombol merah. */
  danger?: boolean;
  /** Hanya tombol OK (pengganti `alert()`). */
  alert?: boolean;
}
interface ConfirmItem extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

let toasts: ToastItem[] = [];
let pending: ConfirmItem | null = null;
const queue: ConfirmItem[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function push(kind: ToastKind, message: string, opts?: { action?: ToastItem["action"]; duration?: number }) {
  const id = ++seq;
  toasts = [...toasts.slice(-4), { id, kind, message, action: opts?.action }];
  emit();
  const ms = opts?.duration ?? (kind === "error" ? 8000 : opts?.action ? 7000 : 4000);
  setTimeout(() => dismiss(id), ms);
  return id;
}
function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** Toast: `toast.success("Tersimpan")`, `toast.error(pesan)`, `toast.info(msg, { action: { label, onClick } })`. */
export const toast = {
  success: (message: string, opts?: { action?: ToastItem["action"]; duration?: number }) =>
    push("success", message, opts),
  error: (message: string, opts?: { action?: ToastItem["action"]; duration?: number }) =>
    push("error", message, opts),
  info: (message: string, opts?: { action?: ToastItem["action"]; duration?: number }) =>
    push("info", message, opts),
  dismiss,
};

/**
 * Dialog konfirmasi (pengganti `confirm()`): `if (await ask("Hapus data ini?")) …`. Opsi `danger` untuk aksi yang
 * menghapus/membatalkan. Di luar browser (SSR) selalu `false`.
 */
export function ask(options: string | ConfirmOptions): Promise<boolean> {
  const opts = typeof options === "string" ? { message: options } : options;
  if (typeof window === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    const item = { ...opts, danger: opts.danger ?? looksDangerous(opts.message), resolve };
    if (pending) queue.push(item);
    else pending = item;
    emit();
  });
}
/** Pengganti `alert()`: dialog dengan satu tombol OK. */
export function tell(message: string, title?: string) {
  return ask({ message, title, alert: true }).then(() => undefined);
}
function settle(ok: boolean) {
  pending?.resolve(ok);
  pending = queue.shift() ?? null;
  emit();
}
const DANGER =
  /\b(hapus|batalkan|batal|tolak|nonaktifkan|cabut|keluarkan|delete|remove|cancel|reject|revoke|void)\b/i;
const looksDangerous = (msg: string) => DANGER.test(msg);

const snapshot = () => ({ toasts, pending });
let lastSnap = snapshot();
const getSnapshot = () => {
  if (lastSnap.toasts !== toasts || lastSnap.pending !== pending) lastSnap = snapshot();
  return lastSnap;
};
const serverSnap = { toasts: [] as ToastItem[], pending: null as ConfirmItem | null };

/** Render toast & dialog konfirmasi; dipasang sekali di layout akar. */
export function FeedbackHost() {
  const { l } = useI18n();
  const state = useSyncExternalStore(subscribe, getSnapshot, () => serverSnap);
  return (
    <>
      <div className="toasts" aria-live="polite">
        {state.toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
            <span className="toast-icon" aria-hidden>
              {t.kind === "success" ? "✓" : t.kind === "error" ? "!" : "i"}
            </span>
            <span className="toast-msg">{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="link"
                onClick={() => {
                  t.action!.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button
              type="button"
              className="toast-close"
              aria-label={l("Tutup", "Close")}
              onClick={() => dismiss(t.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {state.pending && (
        <Modal
          open
          title={
            state.pending.title ??
            (state.pending.alert ? l("Informasi", "Information") : l("Konfirmasi", "Confirm"))
          }
          onClose={() => settle(false)}
          footer={
            <>
              {!state.pending.alert && (
                <button type="button" onClick={() => settle(false)}>
                  {state.pending.cancelLabel ?? l("Batal", "Cancel")}
                </button>
              )}
              <button
                type="button"
                autoFocus
                className={state.pending.danger && !state.pending.alert ? "danger-fill" : "primary"}
                onClick={() => settle(true)}
              >
                {state.pending.confirmLabel ??
                  (state.pending.alert ? "OK" : l("Ya, lanjutkan", "Yes, continue"))}
              </button>
            </>
          }
        >
          <p className="confirm-message">{state.pending.message}</p>
        </Modal>
      )}
    </>
  );
}

/** Modal generik di atas `<dialog>` (Esc / klik latar = tutup). */
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`modal${wide ? " wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <header className="modal-head">
        <h2>{title}</h2>
        <button type="button" className="toast-close" aria-label="×" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="modal-body">{children}</div>
      {footer && <footer className="modal-foot">{footer}</footer>}
    </dialog>
  );
}

/** Kerangka pemuatan (pengganti teks "Memuat…"). */
export function Skeleton({ rows = 5, form }: { rows?: number; form?: boolean }) {
  const { l } = useI18n();
  return (
    <div className={`skeleton${form ? " form" : ""}`} aria-busy="true" aria-label={l("Memuat…", "Loading…")}>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="skeleton-row"
          style={{ width: form ? `${60 + ((i * 17) % 35)}%` : undefined }}
        />
      ))}
    </div>
  );
}

/** Tunda tampilan sebentar (hindari kedipan skeleton untuk muatan cepat). */
export function useDelayed(active: boolean, ms = 150) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!active) {
      setShow(false);
      return;
    }
    const t = setTimeout(() => setShow(true), ms);
    return () => clearTimeout(t);
  }, [active, ms]);
  return show;
}
