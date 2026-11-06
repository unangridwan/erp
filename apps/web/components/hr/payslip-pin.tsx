"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { toast } from "../feedback";

interface PinStatus {
  required: boolean;
  hasPin: boolean;
  unlocked: boolean;
  lockedUntil: string | null;
}

/**
 * Gerbang PIN slip gaji di portal: atur PIN 6 digit (pertama kali) lalu masukkan PIN untuk membuka slip selama
 * 15 menit. 5 kali salah → terkunci 15 menit (HR bisa mengatur ulang).
 */
export function PayslipPinGate({ onUnlocked }: { onUnlocked: () => void }) {
  const { l } = useI18n();
  const [status, setStatus] = useState<PinStatus | null>(null);
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<PinStatus>("/me/payslip-pin").then(setStatus, () => setStatus(null));
  }, []);
  if (!status) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!status.hasPin && pin !== confirm) {
      setError(l("Konfirmasi PIN tidak sama", "PIN confirmation does not match"));
      return;
    }
    setBusy(true);
    try {
      if (status.hasPin) await api("/me/payslip-pin/verify", { method: "POST", body: { pin } });
      else {
        await api("/me/payslip-pin", { method: "PUT", body: { pin } });
        toast.success(l("PIN slip gaji disimpan.", "Payslip PIN saved."));
      }
      setPin("");
      setConfirm("");
      onUnlocked();
    } catch (err) {
      setError(err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : String(err));
      api<PinStatus>("/me/payslip-pin").then(setStatus, () => undefined);
    } finally {
      setBusy(false);
    }
  };
  const pinInput = (value: string, set: (v: string) => void, label: string) => (
    <label className="field">
      <span>{label}</span>
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        value={value}
        onChange={(e) => set(e.target.value.replace(/[^0-9]/g, ""))}
      />
    </label>
  );
  return (
    <form className="payslip-pin" onSubmit={submit}>
      <p className="muted">
        {status.hasPin
          ? l(
              "Masukkan PIN slip gaji untuk membuka slip (berlaku 15 menit).",
              "Enter your payslip PIN to open payslips (valid for 15 minutes).",
            )
          : l(
              "Perusahaan mewajibkan PIN slip gaji. Buat PIN 6 digit yang hanya Anda ketahui.",
              "Your company requires a payslip PIN. Create a 6-digit PIN only you know.",
            )}
      </p>
      {status.lockedUntil && (
        <p className="error">
          {l(
            "PIN terkunci sementara karena terlalu banyak salah; coba lagi nanti atau minta HR mengatur ulang.",
            "PIN temporarily locked after too many attempts; try later or ask HR to reset it.",
          )}
        </p>
      )}
      <div className="payslip-pin-fields">
        {pinInput(pin, setPin, status.hasPin ? l("PIN slip", "Payslip PIN") : l("PIN baru", "New PIN"))}
        {!status.hasPin && pinInput(confirm, setConfirm, l("Ulangi PIN", "Repeat PIN"))}
        <button className="primary" disabled={busy || pin.length !== 6} aria-busy={busy}>
          {status.hasPin ? l("Buka slip", "Open payslips") : l("Simpan PIN", "Save PIN")}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
