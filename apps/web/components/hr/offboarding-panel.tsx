"use client";

import { EXIT_QUESTIONS } from "@erp/shared";
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
}

interface ExitInterview {
  date?: string;
  mainReason?: string;
  scores?: Record<string, number>;
  wouldRejoin?: boolean | null;
  wouldRecommend?: boolean | null;
  comment?: string | null;
}

/** Offboarding karyawan: tanggal & alasan keluar, exit interview, dan Full & Final Statement. */
export function OffboardingPanel({ employeeId }: { employeeId: string }) {
  const { l, locale } = useI18n();
  const [s, setS] = useState<Settlement | null>(null);
  const [form, setForm] = useState({
    resignDate: today(),
    resignReason: "resign",
    resignNote: "",
    startChecklist: true,
  });
  const [ei, setEi] = useState<ExitInterview>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(async () => {
    const settlement = await api<Settlement>(`/employees/${employeeId}/final-settlement`);
    setS(settlement);
    if (settlement.employee.resignDate)
      setForm((f) => ({
        ...f,
        resignDate: settlement.employee.resignDate!,
        resignReason: settlement.employee.resignReason ?? f.resignReason,
        resignNote: settlement.employee.resignNote ?? "",
      }));
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
      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}
      <div className="inline-panel">
        <label className="field">
          <span>{l("Tanggal keluar", "Leaving date")}</span>
          <input
            type="date"
            value={form.resignDate}
            onChange={(e) => setForm({ ...form, resignDate: e.target.value })}
          />
        </label>
        <label className="field">
          <span>{l("Alasan keluar", "Leaving reason")}</span>
          <select
            value={form.resignReason}
            onChange={(e) => setForm({ ...form, resignReason: e.target.value })}
          >
            {Object.entries(RESIGN_REASON_LABEL).map(([k, [id, en]]) => (
              <option key={k} value={k}>
                {l(id, en)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{l("Catatan", "Note")}</span>
          <input
            value={form.resignNote}
            maxLength={1000}
            onChange={(e) => setForm({ ...form, resignNote: e.target.value })}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={form.startChecklist}
            onChange={(e) => setForm({ ...form, startChecklist: e.target.checked })}
          />
          {l("Mulai checklist offboarding", "Start offboarding checklist")}
        </label>
        <button
          type="button"
          className="primary"
          onClick={() =>
            run(
              () =>
                api(`/employees/${employeeId}/offboard`, {
                  method: "POST",
                  body: { ...form, resignNote: form.resignNote || null },
                }),
              l("Data keluar karyawan disimpan.", "Leaving details saved."),
            )
          }
        >
          {left ? l("Perbarui data keluar", "Update leaving details") : l("Proses keluar", "Process leaving")}
        </button>
      </div>

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
