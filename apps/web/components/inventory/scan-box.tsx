"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "../../lib/i18n";

/**
 * Kotak scan barcode: pemindai (keyboard wedge) mengetik kode lalu Enter. Fokus dikembalikan setelah tiap scan
 * agar scan berikutnya bisa langsung dilakukan; pesan hasil terakhir ditampilkan di bawahnya.
 */
export function ScanBox({
  onScan,
  label,
  placeholder,
}: {
  onScan: (code: string) => Promise<string | void>;
  label?: string;
  placeholder?: string;
}) {
  const { l } = useI18n();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const submit = async () => {
    const value = code.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      const text = await onScan(value);
      setMessage({ ok: true, text: text || l(`Terbaca: ${value}`, `Scanned: ${value}`) });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setCode("");
      setBusy(false);
      ref.current?.focus();
    }
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  };
  return (
    <div className="scan-box">
      <label className="field">
        <span>{label ?? l("Scan barcode", "Scan barcode")}</span>
        <input
          ref={ref}
          value={code}
          aria-busy={busy}
          autoComplete="off"
          placeholder={placeholder ?? l("Scan atau ketik kode lalu Enter", "Scan or type a code, then Enter")}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={onKey}
        />
      </label>
      {message && (
        <small className={message.ok ? "success" : "error"} role="status" aria-live="polite">
          {message.text}
        </small>
      )}
    </div>
  );
}
