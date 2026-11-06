"use client";

import { useState } from "react";
import { download } from "../accounting/download";
import { api } from "../../lib/api";
import { formatDate } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { ask, toast } from "../feedback";

export interface ProbationInfo {
  id: string;
  name: string;
  state: string;
  dateStart: string;
  probationMonths: number | null;
  probationEnd: string | null;
  probationResult: "passed" | "failed" | null;
  probationNote: string | null;
}

/** Masa percobaan kontrak PKWTT: sisa hari, evaluasi lulus/tidak, dan surat pengangkatan setelah lulus. */
export function ProbationPanel({
  contract,
  manage,
  onChange,
}: {
  contract: ProbationInfo;
  manage: boolean;
  onChange: () => void;
}) {
  const { l, locale } = useI18n();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  if (!contract.probationEnd) return null;
  const days = Math.round(
    (Date.parse(contract.probationEnd) - Date.parse(new Date().toISOString().slice(0, 10))) / 86_400_000,
  );
  const decide = async (result: "passed" | "failed") => {
    const ok = await ask({
      title:
        result === "passed"
          ? l("Lulus masa percobaan", "Passed probation")
          : l("Tidak lulus", "Failed probation"),
      message:
        result === "passed"
          ? l("Karyawan diangkat sebagai karyawan tetap.", "The employee is confirmed as permanent.")
          : l(
              "Catat tidak lulus? Akhiri hubungan kerja lewat tombol Akhiri kontrak setelah ini.",
              "Record as failed? End the employment with End contract afterwards.",
            ),
      danger: result === "failed",
      confirmLabel: result === "passed" ? l("Lulus", "Pass") : l("Tidak lulus", "Fail"),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api(`/contracts/${contract.id}/probation`, {
        method: "POST",
        body: { result, note: note || null },
      });
      toast.success(l("Hasil masa percobaan disimpan.", "Probation result saved."));
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel probation-panel">
      <header className="toolbar">
        <h2>{l("Masa percobaan", "Probation")}</h2>
        {contract.probationResult ? (
          <span className={`pill${contract.probationResult === "passed" ? " ok" : " bad"}`}>
            {contract.probationResult === "passed" ? l("Lulus", "Passed") : l("Tidak lulus", "Failed")}
          </span>
        ) : (
          <span className={`pill${days <= 14 ? " warn" : ""}`}>
            {days >= 0
              ? l(`${days} hari lagi`, `${days} days left`)
              : l("Lewat, belum dievaluasi", "Overdue")}
          </span>
        )}
      </header>
      <p className="muted">
        {l(
          `${contract.probationMonths} bulan: ${formatDate(contract.dateStart, locale)} – ${formatDate(contract.probationEnd, locale)}.`,
          `${contract.probationMonths} months: ${formatDate(contract.dateStart, locale)} – ${formatDate(contract.probationEnd, locale)}.`,
        )}
        {contract.probationNote ? ` ${contract.probationNote}` : ""}
      </p>
      {!contract.probationResult && manage && contract.state === "running" && (
        <div className="probation-actions">
          <input
            placeholder={l("Catatan evaluasi (opsional)", "Evaluation note (optional)")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button type="button" className="primary" disabled={busy} onClick={() => void decide("passed")}>
            {l("Lulus", "Pass")}
          </button>
          <button type="button" className="danger" disabled={busy} onClick={() => void decide("failed")}>
            {l("Tidak lulus", "Fail")}
          </button>
        </div>
      )}
      {contract.probationResult === "passed" && (
        <button
          type="button"
          onClick={() =>
            download(
              `/contracts/${contract.id}/appointment-letter`,
              `pengangkatan-${contract.name}.pdf`,
            ).catch((e: Error) => toast.error(e.message))
          }
        >
          {l("Surat pengangkatan (PDF)", "Appointment letter (PDF)")}
        </button>
      )}
    </section>
  );
}
