"use client";

import { EXIT_QUESTIONS } from "@erp/shared";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { download } from "../accounting/download";
import { api } from "../../lib/api";
import { formatDate, money, today } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { errorText } from "./hr-panels";

export const RESIGN_REASON_LABEL: Record<string, [string, string]> = {
  resign: ["Mengundurkan diri", "Resignation"],
  end_contract: ["Kontrak berakhir", "End of contract"],
  termination: ["PHK", "Termination"],
  retirement: ["Pensiun", "Retirement"],
  death: ["Meninggal dunia", "Death"],
  other: ["Lainnya", "Other"],
};

export const EXIT_REASON_LABEL: Record<string, [string, string]> = {
  compensation: ["Gaji & tunjangan", "Pay & benefits"],
  career: ["Pengembangan karier", "Career growth"],
  manager: ["Atasan", "Manager"],
  workload: ["Beban kerja", "Workload"],
  environment: ["Lingkungan kerja", "Work environment"],
  work_life: ["Keseimbangan hidup", "Work-life balance"],
  relocation: ["Pindah domisili", "Relocation"],
  study: ["Melanjutkan studi", "Further study"],
  health: ["Kesehatan", "Health"],
  family: ["Keluarga", "Family"],
  other: ["Lainnya", "Other"],
};

interface Settlement {
  employee: {
    resignDate: string | null;
    resignReason: string | null;
    resignNote: string | null;
    employeeNumber: string;
  };
  items: { kind: string; label: string; amount: string; direction: "pay" | "deduct" }[];
  totalPay: string;
  totalDeduct: string;
  net: string;
  openTasks: { name: string; dueDate: string }[];
  /** Pengajuan persetujuan terakhir: keluar & Full and Final. */
  approvals?: { exit: OffboardingApproval | null; settlement: OffboardingApproval | null };
  /** Karyawan keluar wajib disetujui (Pengaturan Payroll). */
  offboardingApproval?: boolean;
}

interface OffboardingApproval {
  id: string;
  state: "pending" | "approved" | "refused" | "cancel";
  number: string | null;
  requestId: string | null;
  net: string;
  createdAt: string;
  decidedAt: string | null;
  payload: { resignDate?: string; resignReason?: string } | null;
}

const APPROVAL_STATE: Record<OffboardingApproval["state"], [string, string]> = {
  pending: ["Menunggu persetujuan", "Awaiting approval"],
  approved: ["Disetujui", "Approved"],
  refused: ["Ditolak", "Refused"],
  cancel: ["Dibatalkan", "Cancelled"],
};

/** Status satu pengajuan persetujuan (tautan ke permintaan). */
function ApprovalBadge({ a }: { a: OffboardingApproval }) {
  const { l } = useI18n();
  return (
    <span className={`pill ${a.state === "approved" ? "ok" : a.state === "pending" ? "warn" : "bad"}`}>
      {l(...APPROVAL_STATE[a.state])}
      {a.requestId && (
        <>
          {" · "}
          <Link href={`/hr/approval-requests/${a.requestId}`}>{a.number ?? l("permintaan", "request")}</Link>
        </>
      )}
    </span>
  );
}

interface ExitInterview {
  date?: string;
  mainReason?: string;
  scores?: Record<string, number>;
  wouldRejoin?: boolean | null;
  wouldRecommend?: boolean | null;
  comment?: string | null;
}

/**
 * Offboarding karyawan: data keluar (diisi lewat Akhiri kontrak di kontrak kerja — satu-satunya tempat tanggal keluar
 * diinput), exit interview, dan Full & Final Statement.
 */
export function OffboardingPanel({ employeeId }: { employeeId: string }) {
  const { l, locale } = useI18n();
  const [s, setS] = useState<Settlement | null>(null);
  /** Kontrak tempat keluar diproses: kontrak keluar, atau kontrak berjalan/terakhir. */
  const [contract, setContract] = useState<{ id: string; name: string; endReason: string | null } | null>(
    null,
  );
  const [ei, setEi] = useState<ExitInterview>({});
  const [exitForm, setExitForm] = useState({ resignDate: today(), resignReason: "resign", resignNote: "" });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(async () => {
    const settlement = await api<Settlement>(`/employees/${employeeId}/final-settlement`);
    setS(settlement);
    const contracts = await api<{
      items: { id: string; name: string; state: string; endReason: string | null }[];
    }>(`/contracts?employeeId=${employeeId}`).then(
      (r) => r.items.filter((c) => c.state !== "cancel" && c.state !== "draft"),
      () => [],
    );
    setContract(
      contracts.find((c) => c.endReason) ??
        contracts.find((c) => c.state === "running") ??
        contracts[0] ??
        null,
    );
    setEi(await api<ExitInterview>(`/employees/${employeeId}/exit-interview`));
  }, [employeeId]);
  useEffect(() => {
    load().catch((e) => setError(errorText(e)));
  }, [load]);

  async function run(fn: () => Promise<unknown>, message: string) {
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(message);
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  }
  if (!s) return null;
  const left = !!s.employee.resignDate;

  return (
    <section className="panel offboarding">
      <h2>{l("Offboarding", "Offboarding")}</h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="notice">{notice}</p>}
      {left ? (
        <p>
          <span className="pill bad">{l("Keluar", "Left")}</span>{" "}
          <strong>{formatDate(s.employee.resignDate, locale)}</strong>
          {s.employee.resignReason && RESIGN_REASON_LABEL[s.employee.resignReason]
            ? ` — ${l(...RESIGN_REASON_LABEL[s.employee.resignReason]!)}`
            : ""}
          {s.employee.resignNote ? ` · ${s.employee.resignNote}` : ""}
          {contract && (
            <>
              {" · "}
              <Link href={`/hr/contracts/${contract.id}`}>
                {l(`Ubah di kontrak ${contract.name}`, `Edit on contract ${contract.name}`)}
              </Link>
            </>
          )}
        </p>
      ) : s.offboardingApproval ? (
        <div className="stack">
          {s.approvals?.exit && (
            <p>
              {l("Pengajuan keluar", "Exit request")}
              {s.approvals.exit.payload?.resignDate
                ? ` ${formatDate(s.approvals.exit.payload.resignDate, locale)}`
                : ""}
              : <ApprovalBadge a={s.approvals.exit} />
            </p>
          )}
          {s.approvals?.exit?.state !== "pending" && (
            <>
              <p className="muted">
                {l(
                  "Persetujuan offboarding aktif: ajukan tanggal & alasan keluar; karyawan diproses keluar (kontrak diakhiri, checklist offboarding dimulai) setelah disetujui. Cuplikan Full & Final Statement ikut dalam pengajuan.",
                  "Offboarding approval is on: submit the leaving date & reason; the exit is processed (contract ended, offboarding checklist started) once approved. A Full & Final Statement snapshot is included.",
                )}
              </p>
              <div className="inline-panel">
                <label className="field">
                  <span>{l("Tanggal keluar", "Leaving date")}</span>
                  <input
                    type="date"
                    value={exitForm.resignDate}
                    onChange={(e) => setExitForm({ ...exitForm, resignDate: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>{l("Alasan", "Reason")}</span>
                  <select
                    value={exitForm.resignReason}
                    onChange={(e) => setExitForm({ ...exitForm, resignReason: e.target.value })}
                  >
                    {Object.entries(RESIGN_REASON_LABEL).map(([k, [id, en]]) => (
                      <option key={k} value={k}>
                        {l(id, en)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field grow">
                  <span>{l("Catatan", "Note")}</span>
                  <input
                    maxLength={1000}
                    value={exitForm.resignNote}
                    onChange={(e) => setExitForm({ ...exitForm, resignNote: e.target.value })}
                  />
                </label>
                <button
                  type="button"
                  className="primary"
                  onClick={() =>
                    run(
                      () =>
                        api(`/employees/${employeeId}/offboard`, {
                          method: "POST",
                          body: { ...exitForm, resignNote: exitForm.resignNote || null },
                        }),
                      l(
                        "Pengajuan keluar dikirim untuk persetujuan.",
                        "Exit request submitted for approval.",
                      ),
                    )
                  }
                >
                  {l("Ajukan keluar", "Submit exit")}
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <p className="muted">
          {l(
            "Tanggal & alasan keluar diisi di kontrak kerja: buka kontrak lalu pilih Akhiri kontrak → karyawan keluar. Checklist offboarding dimulai otomatis.",
            "The leaving date & reason are set on the employment contract: open it and choose End contract → employee leaves. The offboarding checklist starts automatically.",
          )}{" "}
          {contract && (
            <Link href={`/hr/contracts/${contract.id}`}>
              {l(`Buka kontrak ${contract.name}`, `Open contract ${contract.name}`)}
            </Link>
          )}
        </p>
      )}

      {left && (
        <>
          <h3>{l("Exit interview", "Exit interview")}</h3>
          <div className="inline-panel exit-interview">
            <label className="field">
              <span>{l("Tanggal", "Date")}</span>
              <input
                type="date"
                value={ei.date ?? today()}
                onChange={(e) => setEi({ ...ei, date: e.target.value })}
              />
            </label>
            <label className="field">
              <span>{l("Alasan utama", "Main reason")}</span>
              <select
                value={ei.mainReason ?? ""}
                onChange={(e) => setEi({ ...ei, mainReason: e.target.value })}
              >
                <option value="">—</option>
                {Object.entries(EXIT_REASON_LABEL).map(([k, [id, en]]) => (
                  <option key={k} value={k}>
                    {l(id, en)}
                  </option>
                ))}
              </select>
            </label>
            {EXIT_QUESTIONS.map((q) => (
              <label key={q.key} className="field">
                <span>{l(q.label[0], q.label[1])} (1–5)</span>
                <select
                  value={ei.scores?.[q.key] ?? ""}
                  onChange={(e) => {
                    const scores = { ...(ei.scores ?? {}) };
                    if (e.target.value) scores[q.key] = Number(e.target.value);
                    else delete scores[q.key];
                    setEi({ ...ei, scores });
                  }}
                >
                  <option value="">—</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            {(
              [
                ["wouldRejoin", l("Mau bergabung kembali", "Would rejoin")],
                ["wouldRecommend", l("Merekomendasikan perusahaan", "Would recommend")],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="field">
                <span>{label}</span>
                <select
                  value={ei[k] === true ? "yes" : ei[k] === false ? "no" : ""}
                  onChange={(e) =>
                    setEi({ ...ei, [k]: e.target.value === "" ? null : e.target.value === "yes" })
                  }
                >
                  <option value="">—</option>
                  <option value="yes">{l("Ya", "Yes")}</option>
                  <option value="no">{l("Tidak", "No")}</option>
                </select>
              </label>
            ))}
            <label className="field wide">
              <span>{l("Komentar", "Comments")}</span>
              <textarea
                rows={2}
                maxLength={2000}
                value={ei.comment ?? ""}
                onChange={(e) => setEi({ ...ei, comment: e.target.value })}
              />
            </label>
            <button
              type="button"
              disabled={!ei.mainReason}
              onClick={() =>
                run(
                  () =>
                    api(`/employees/${employeeId}/exit-interview`, {
                      method: "PUT",
                      body: {
                        date: ei.date ?? today(),
                        mainReason: ei.mainReason,
                        scores: ei.scores ?? {},
                        wouldRejoin: ei.wouldRejoin ?? null,
                        wouldRecommend: ei.wouldRecommend ?? null,
                        comment: ei.comment || null,
                      },
                    }),
                  l("Exit interview disimpan.", "Exit interview saved."),
                )
              }
            >
              {l("Simpan exit interview", "Save exit interview")}
            </button>
          </div>
        </>
      )}

      <h3>
        {l("Full & Final Statement", "Full & Final Statement")}{" "}
        <button
          type="button"
          className="link"
          onClick={() =>
            download(
              `/employees/${employeeId}/final-settlement/pdf`,
              `full-final-${s.employee.employeeNumber}.pdf`,
            ).catch((e: Error) => setError(e.message))
          }
        >
          PDF
        </button>
      </h3>
      {left && (
        <p>
          {s.approvals?.settlement ? (
            <>
              {l("Persetujuan F&F", "F&F approval")}: <ApprovalBadge a={s.approvals.settlement} />{" "}
            </>
          ) : (
            <span className="muted">
              {l("F&F belum diajukan untuk persetujuan. ", "F&F not submitted for approval. ")}
            </span>
          )}
          {s.approvals?.settlement?.state !== "pending" && (
            <button
              type="button"
              className="link"
              onClick={() =>
                run(
                  () => api(`/employees/${employeeId}/final-settlement/approval`, { method: "POST" }),
                  l(
                    "Full & Final Statement diajukan untuk persetujuan.",
                    "Full & Final Statement submitted for approval.",
                  ),
                )
              }
            >
              {s.approvals?.settlement
                ? l("Ajukan ulang", "Submit again")
                : l("Ajukan persetujuan", "Submit for approval")}
            </button>
          )}
        </p>
      )}
      <div className="table-wrap">
        <table>
          <tbody>
            {s.items.map((i) => (
              <tr key={i.kind + i.label}>
                <td>{i.label}</td>
                <td className={`num ${i.direction === "deduct" ? "negative" : ""}`}>
                  {i.direction === "deduct" ? "−" : ""}
                  {money(i.amount, locale)}
                </td>
              </tr>
            ))}
            {s.items.length === 0 && (
              <tr>
                <td colSpan={2} className="muted">
                  {l("Tidak ada hak atau kewajiban yang tersisa.", "No outstanding rights or obligations.")}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <th>
                {Number(s.net) >= 0
                  ? l("Dibayar ke karyawan", "Payable to employee")
                  : l("Ditagih ke karyawan", "Owed by employee")}
              </th>
              <th className="num">{money(String(Math.abs(Number(s.net))), locale)}</th>
            </tr>
          </tfoot>
        </table>
      </div>
      {s.openTasks.length > 0 && (
        <p className="muted">
          {l("Checklist offboarding belum selesai:", "Open offboarding tasks:")}{" "}
          {s.openTasks.map((t) => `${t.name} (${formatDate(t.dueDate, locale)})`).join(" · ")}
        </p>
      )}
    </section>
  );
}
