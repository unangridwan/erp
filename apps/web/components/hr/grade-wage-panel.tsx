"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "../../lib/api";
import { formatDate, money } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { can } from "../../lib/resources";
import { ask, toast } from "../feedback";
import { useMe } from "../me-context";

interface Impact {
  grade: { id: string; code: string; name: string; baseWage: string | null };
  items: {
    contractId: string;
    contractName: string;
    dateStart: string;
    wage: string;
    employeeId: string;
    employeeNumber: string;
    employeeName: string;
    status: "current" | "standard" | "adjusted";
  }[];
}

/**
 * Golongan upah: terapkan gaji pokok standar yang baru ke kontrak berjalan karyawan bergolongan ini (kontrak upah baru
 * per tanggal berlaku). Kontrak yang gaji pokoknya disesuaikan manual dilewati kecuali dipilih.
 */
export function GradeBaseWagePanel({ id }: { id: string }) {
  const me = useMe();
  const { l, locale } = useI18n();
  const [impact, setImpact] = useState<Impact | null>(null);
  const [date, setDate] = useState(() => {
    const d = new Date();
    return new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 1)).toISOString().slice(0, 10);
  });
  const [includeAdjusted, setIncludeAdjusted] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!can(me.permissions, "payroll.manage")) return null;

  const load = () =>
    api<Impact>(`/salary-grades/${id}/base-wage-impact`).then(setImpact, (e: Error) =>
      toast.error(e.message),
    );
  const STATUS = {
    current: l("Sudah sesuai", "Up to date"),
    standard: l("Mengikuti standar lama", "Follows old standard"),
    adjusted: l("Disesuaikan manual", "Manually adjusted"),
  };
  const targets = impact?.items.filter(
    (i) => i.status === "standard" || (includeAdjusted && i.status === "adjusted"),
  );

  const apply = async () => {
    if (!impact?.grade.baseWage || !targets?.length) return;
    const ok = await ask({
      title: l("Terapkan gaji pokok golongan", "Apply grade base wage"),
      message: l(
        `${targets.length} karyawan mendapat SK Penyesuaian upah ke gaji pokok ${money(impact.grade.baseWage, locale)} mulai ${formatDate(date, locale)} (bila SK mutasi wajib disetujui, SK dibuat sebagai draft). Selisih periode yang sudah dibayar dihitung lewat "Hitung rapel" di payroll.`,
        `${targets.length} employees get a wage adjustment decree to base wage ${money(impact.grade.baseWage, locale)} from ${formatDate(date, locale)} (drafts when decrees require approval). Differences for paid periods are calculated with "Compute back pay" in payroll.`,
      ),
      confirmLabel: l("Terapkan", "Apply"),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api<{
        updated: unknown[];
        pending: unknown[];
        skipped: { employeeName: string; reason: string }[];
      }>(`/salary-grades/${id}/apply-base-wage`, {
        method: "POST",
        body: { effectiveDate: date, includeAdjusted },
      });
      const late = r.skipped.filter((s) => s.reason === "date").length;
      const open = r.skipped.filter((s) => s.reason === "pending").length;
      const notes = [
        late
          ? l(
              `${late} dilewati (kontrak mulai setelah tanggal berlaku)`,
              `${late} skipped (contract starts after the effective date)`,
            )
          : null,
        open
          ? l(
              `${open} dilewati (masih ada SK upah draft)`,
              `${open} skipped (a wage decree is still in draft)`,
            )
          : null,
      ].filter(Boolean);
      const tail = notes.length ? `, ${notes.join(", ")}` : "";
      toast.success(
        r.pending.length
          ? l(
              `${r.pending.length} SK Penyesuaian upah dibuat sebagai draft — ajukan persetujuan lalu terapkan di Promosi & Mutasi${tail}.`,
              `${r.pending.length} wage adjustment decrees created as drafts — submit for approval and apply in Promotions & Transfers${tail}.`,
            )
          : l(
              `${r.updated.length} kontrak disesuaikan lewat SK Penyesuaian upah${tail}.`,
              `${r.updated.length} contracts updated via wage adjustment decrees${tail}.`,
            ),
      );
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <header className="toolbar">
        <h2>{l("Kontrak berjalan golongan ini", "Running contracts in this grade")}</h2>
        <button type="button" onClick={() => void load()}>
          {impact ? l("Muat ulang", "Reload") : l("Periksa kontrak", "Check contracts")}
        </button>
      </header>
      <p className="muted">
        {l(
          "Gaji pokok golongan terisi otomatis saat membuat kontrak dan tetap bisa diubah. Bila gaji pokok golongan berubah, terapkan ke kontrak berjalan yang masih mengikuti standar lama.",
          "The grade base wage is filled in automatically when creating a contract and can still be changed. When it changes, apply it to running contracts that still follow the old standard.",
        )}
      </p>
      {impact && (
        <>
          {!impact.grade.baseWage && (
            <p className="error">
              {l("Isi dan simpan gaji pokok golongan dulu.", "Fill in and save the grade base wage first.")}
            </p>
          )}
          {impact.items.length === 0 ? (
            <p className="muted">
              {l("Belum ada kontrak berjalan bergolongan ini.", "No running contracts in this grade yet.")}
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{l("Karyawan", "Employee")}</th>
                    <th>{l("Kontrak", "Contract")}</th>
                    <th className="num">{l("Gaji pokok", "Base wage")}</th>
                    <th>{l("Status", "Status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {impact.items.map((i) => (
                    <tr key={i.contractId}>
                      <td>
                        <Link href={`/employees/${i.employeeId}`}>{i.employeeName}</Link>{" "}
                        <small className="muted">{i.employeeNumber}</small>
                      </td>
                      <td>
                        <Link href={`/hr/contracts/${i.contractId}`}>{i.contractName}</Link>{" "}
                        <small className="muted">{formatDate(i.dateStart, locale)}</small>
                      </td>
                      <td className="num">{money(i.wage, locale)}</td>
                      <td>
                        <span
                          className={`pill${i.status === "current" ? " ok" : i.status === "standard" ? " warn" : ""}`}
                        >
                          {STATUS[i.status]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {impact.grade.baseWage && impact.items.some((i) => i.status !== "current") && (
            <div className="grade-apply">
              <label>
                {l("Berlaku mulai", "Effective from")}
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={includeAdjusted}
                  onChange={(e) => setIncludeAdjusted(e.target.checked)}
                />
                {l("Termasuk kontrak yang disesuaikan manual", "Include manually adjusted contracts")}
              </label>
              <button
                type="button"
                className="primary"
                disabled={busy || !targets?.length}
                aria-busy={busy}
                onClick={() => void apply()}
              >
                {l(
                  `Terapkan ${money(impact.grade.baseWage, locale)} ke ${targets?.length ?? 0} kontrak`,
                  `Apply ${money(impact.grade.baseWage, locale)} to ${targets?.length ?? 0} contracts`,
                )}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
