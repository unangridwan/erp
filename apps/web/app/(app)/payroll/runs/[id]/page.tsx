"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ApprovalStatus,
  approvalCleared,
  type ApprovalInfo,
} from "../../../../../components/approval-status";
import { download } from "../../../../../components/accounting/download";
import { useOptions } from "../../../../../components/accounting/use-options";
import { useMe } from "../../../../../components/me-context";
import { CorrectionForm, PayrollWarnings } from "../../../../../components/payroll/run-extras";
import { api } from "../../../../../lib/api";
import { formatDate, money, today } from "../../../../../lib/format";
import { useI18n } from "../../../../../lib/i18n";
import { can, PAYROLL_STATE_LABEL } from "../../../../../lib/resources";
import { SortTh, TablePager, TableTools, type ViewColumn } from "../../../../../components/data-table";
import { useTableView } from "../../../../../lib/use-table-view";
import { ask } from "../../../../../components/feedback";
import { RelatedDocuments } from "../../../../../components/related-documents";

interface Run {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  paymentDate: string;
  state: string;
  kind: "regular" | "correction";
  correctsRunId: string | null;
  totals: Record<
    | "earnings"
    | "gross"
    | "pph21"
    | "kesEmployee"
    | "kesEmployer"
    | "tkEmployee"
    | "tkEmployer"
    | "deductions"
    | "net",
    string
  >;
  payslips: {
    id: string;
    employeeId: string;
    holdReason: string | null;
    releasedAt: string | null;
    employeeName: string;
    employeeNumber: string;
    departmentName: string | null;
    ptkpStatus: string;
    terCategory: string;
    terRate: string | null;
    isFinal: boolean;
    unpaidDays: string;
    earnings: string;
    gross: string;
    pph21: string;
    kesEmployee: string;
    tkEmployee: string;
    net: string;
    emailedAt: string | null;
    emailError: string | null;
  }[];
  accountMove: { id: string; name: string | null } | null;
  paymentMove: { id: string; name: string | null } | null;
  approval?: ApprovalInfo;
}

/** Detail payroll: slip per karyawan, hitung ulang, posting, bayar, file transfer bank & rekap PPh 21/BPJS. */
export default function PayrollRunPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const router = useRouter();
  const { l, tx, locale } = useI18n();
  const journals = useOptions<{ id: string; code: string; name: string; journalType: string }>("/journals");
  const [run, setRun] = useState<Run | null>(null);
  const [journalId, setJournalId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [holidayDate, setHolidayDate] = useState("");
  const [holiday, setHoliday] = useState("");
  const [bankFormat, setBankFormat] = useState("csv");
  const [version, setVersion] = useState(0);

  type Slip = Run["payslips"][number];
  const columns = useMemo<ViewColumn<Slip>[]>(() => {
    const amount = (
      key: "earnings" | "gross" | "pph21" | "kesEmployee" | "tkEmployee" | "net",
      label: string,
    ) => ({
      key,
      label,
      type: "number" as const,
      value: (p: Slip) => Number(p[key]),
    });
    return [
      {
        key: "employee",
        label: l("Karyawan", "Employee"),
        value: (p) => p.employeeName,
        text: (p) => `${p.employeeName} ${p.employeeNumber}`,
      },
      {
        key: "department",
        label: l("Departemen", "Department"),
        type: "enum",
        value: (p) => p.departmentName,
        hidden: true,
      },
      {
        key: "ptkp",
        label: "PTKP / TER",
        type: "enum",
        value: (p) => p.ptkpStatus,
      },
      {
        key: "unpaidDays",
        label: l("Hari tak dibayar", "Unpaid days"),
        type: "number",
        value: (p) => Number(p.unpaidDays),
      },
      amount("earnings", l("Pendapatan", "Earnings")),
      amount("gross", l("Bruto PPh 21", "PPh 21 gross")),
      amount("pph21", "PPh 21"),
      amount("kesEmployee", l("BPJS Kesehatan", "BPJS Health")),
      amount("tkEmployee", l("BPJS Ketenagakerjaan", "BPJS Employment")),
      amount("net", l("Gaji bersih", "Net")),
      {
        key: "hold",
        label: l("Penahanan", "Hold"),
        type: "enum",
        value: (p) => (!p.holdReason ? "none" : p.releasedAt ? "released" : "held"),
        optionLabel: (v) =>
          v === "held"
            ? l("Ditahan", "On hold")
            : v === "released"
              ? l("Sudah dilepas", "Released")
              : l("Tidak ditahan", "Not held"),
        hidden: true,
      },
      {
        key: "emailed",
        label: l("Slip email", "Payslip email"),
        type: "enum",
        value: (p) => (p.emailError ? "error" : p.emailedAt ? "sent" : "none"),
        optionLabel: (v) =>
          v === "sent"
            ? l("Terkirim", "Sent")
            : v === "error"
              ? l("Gagal", "Failed")
              : l("Belum dikirim", "Not sent"),
        hidden: true,
      },
    ];
  }, [l]);
  const table = useTableView(run?.payslips ?? [], columns, { storageKey: "payroll-run-slips" });

  const load = () =>
    api<Run>(`/payroll-runs/${id}`)
      .then((r) => {
        setRun(r);
        setVersion((v) => v + 1);
      })
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, [id]);

  /** Aksi yang mengembalikan ringkasan (THR, rapel, email): tampilkan pesan lalu muat ulang payroll. */
  async function summaryAction<T>(path: string, body: object, message: (r: T) => string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api<T>(`/payroll-runs/${id}/${path}`, { method: "POST", body });
      setNotice(message(r));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function act(path: string, body?: object) {
    setBusy(true);
    setError(null);
    try {
      setRun(await api<Run>(`/payroll-runs/${id}/${path}`, { method: "POST", body: body ?? {} }));
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!run) return <p className="muted">{error ?? l("Memuat…", "Loading…")}</p>;
  const manage = can(me.permissions, "payroll.manage");
  const banks = journals.filter((j) => j.journalType === "bank" || j.journalType === "cash");
  const n = (v: string) => money(v, locale);
  const correction = run.kind === "correction";
  const pendingHold = run.payslips.filter((p) => p.holdReason && !p.releasedAt);
  const payable = run.payslips
    .filter((p) => !p.holdReason)
    .reduce((s, p) => s + Number(p.net), 0)
    .toFixed(2);

  /** Tahan / batal tahan / lepas gaji satu slip. */
  async function slipAction(slipId: string, path: "hold" | "unhold" | "release") {
    let body: object = {};
    if (path === "hold") {
      const reason = prompt(l("Alasan gaji ditahan", "Reason for holding the salary"));
      if (!reason) return;
      body = { reason };
    }
    if (path === "release") {
      if (!journalId) return setError(l("Pilih jurnal kas/bank pembayaran", "Choose the payment journal"));
      body = { journalId, date: today() };
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/payslips/${slipId}/${path}`, { method: "POST", body });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <header className="toolbar">
        <h1>{run.name}</h1>
        <span
          className={`badge state-${run.state === "paid" ? "sale" : run.state === "done" ? "posted" : run.state}`}
        >
          {tx(PAYROLL_STATE_LABEL[run.state]!)}
        </span>
        {correction && <span className="badge">{l("Koreksi", "Correction")}</span>}
        {!correction &&
          (run.state === "done" || run.state === "paid") &&
          can(me.permissions, "payroll.write") && (
            <CorrectionForm
              runId={run.id}
              employees={run.payslips.map((p) => ({
                employeeId: p.employeeId,
                employeeName: p.employeeName,
              }))}
            />
          )}
        {run.state === "draft" && can(me.permissions, "payroll.write") && (
          <button type="button" disabled={busy} onClick={() => act("compute")}>
            {l("Hitung ulang", "Recompute")}
          </button>
        )}
        {run.state === "draft" && manage && (
          <ApprovalStatus approval={run.approval} busy={busy} onSubmit={() => act("submit-approval")} />
        )}
        {run.state === "draft" && manage && (
          <button
            type="button"
            className="primary"
            disabled={busy || !approvalCleared(run.approval)}
            title={
              approvalCleared(run.approval)
                ? undefined
                : l(
                    "Payroll harus disetujui sebelum diposting",
                    "The payroll must be approved before posting",
                  )
            }
            onClick={async () =>
              (await ask(
                l(
                  "Posting payroll ke jurnal? Slip tidak bisa diubah lagi.",
                  "Post payroll? Payslips will be locked.",
                ),
              )) && act("post")
            }
          >
            {l("Posting", "Post")}
          </button>
        )}
        {run.state === "draft" && can(me.permissions, "payroll.write") && (
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={async () => {
              if (!(await ask(l("Batalkan payroll ini?", "Cancel this payroll run?")))) return;
              await api(`/payroll-runs/${id}/cancel`, { method: "POST" }).catch((e: Error) =>
                setError(e.message),
              );
              router.replace("/payroll/runs");
            }}
          >
            {l("Batalkan", "Cancel")}
          </button>
        )}
        {manage && (
          <>
            <select
              aria-label={l("Format file transfer", "Transfer file format")}
              value={bankFormat}
              onChange={(e) => setBankFormat(e.target.value)}
            >
              <option value="csv">{l("CSV umum (semua bank)", "Generic CSV (all banks)")}</option>
              <option value="bca">BCA — KlikBCA Bisnis</option>
              <option value="mandiri">Mandiri — MCM</option>
              <option value="bri">BRI — CMS</option>
              <option value="bni">BNI — BNIDirect</option>
            </select>
            <button
              type="button"
              onClick={() =>
                download(
                  `/payroll-runs/${id}/bank-transfer?format=${bankFormat}`,
                  `transfer-gaji-${bankFormat}-${run.periodStart.slice(0, 7)}.${bankFormat === "bca" ? "txt" : "csv"}`,
                ).catch((e: Error) => setError(e.message))
              }
            >
              {l("File transfer bank", "Bank transfer file")}
            </button>
            <Link className="button" href={`/payroll/data?runId=${id}`}>
              {l("Impor/ekspor Excel", "Excel import/export")}
            </Link>
            {(
              [
                ["csv", l("Rekap PPh 21 & BPJS", "PPh 21 & BPJS recap"), "pph21-bpjs"],
                ["edabu", "BPJS Kesehatan (e-Dabu)", "bpjs-kesehatan-edabu"],
                ["sipp", "BPJS Ketenagakerjaan (SIPP)", "bpjs-ketenagakerjaan-sipp"],
              ] as const
            ).map(([format, label, file]) => (
              <button
                key={format}
                type="button"
                onClick={() =>
                  download(
                    `/payroll-runs/${id}/recap?format=${format}`,
                    `${file}-${run.periodStart.slice(0, 7)}.csv`,
                  ).catch((e: Error) => setError(e.message))
                }
              >
                {label}
              </button>
            ))}
            {run.state !== "draft" && run.state !== "cancel" && (
              <button
                type="button"
                disabled={busy}
                onClick={async () =>
                  (await ask(
                    l(
                      "Kirim slip gaji (PDF berkata sandi tanggal lahir) ke email kerja karyawan?",
                      "Email payslips (PDF protected with the birth date) to employees' work emails?",
                    ),
                  )) &&
                  summaryAction<{ sent: number; failed: number; skipped: { name: string }[] }>(
                    "email-payslips",
                    {},
                    (r) =>
                      l(
                        `${r.sent} slip terkirim, ${r.failed} gagal, ${r.skipped.length} dilewati (tanpa email)${r.skipped.length ? `: ${r.skipped.map((x) => x.name).join(", ")}` : ""}.`,
                        `${r.sent} payslips sent, ${r.failed} failed, ${r.skipped.length} skipped (no email)${r.skipped.length ? `: ${r.skipped.map((x) => x.name).join(", ")}` : ""}.`,
                      ),
                  )
                }
              >
                {l("Kirim slip via email", "Email payslips")}
              </button>
            )}
          </>
        )}
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="notice">{notice}</p>}
      {run.state !== "cancel" && <PayrollWarnings runId={run.id} version={version} />}
      {correction && (
        <p className="muted">
          {l("Payroll koreksi atas", "Correction of")}{" "}
          <Link href={`/payroll/runs/${run.correctsRunId}`}>
            {l("payroll reguler", "the regular payroll")}
          </Link>
          {". "}
          {l(
            "Isi selisih tunjangan/potongan di tiap slip; PPh 21 dihitung atas bruto gabungan bulan ini dikurangi yang sudah dipotong.",
            "Enter allowance/deduction differences per payslip; PPh 21 uses this month's combined gross minus tax already withheld.",
          )}
        </p>
      )}
      {run.state === "draft" && !correction && can(me.permissions, "payroll.write") && (
        <div className="inline-panel">
          <label className="field">
            <span>{l("Tanggal hari raya", "Holiday date")}</span>
            <input type="date" value={holidayDate} onChange={(e) => setHolidayDate(e.target.value)} />
          </label>
          <label className="field">
            <span>{l("Hari raya", "Holiday")}</span>
            <input
              placeholder="Idul Fitri 1447 H"
              value={holiday}
              onChange={(e) => setHoliday(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={!holidayDate || busy}
            onClick={() =>
              summaryAction<{ total: string; items: { eligible: boolean }[] }>(
                "thr",
                { holidayDate, holiday: holiday || null },
                (r) =>
                  l(
                    `THR ${r.items.filter((i) => i.eligible).length} karyawan, total ${n(r.total)} (Permenaker 6/2016).`,
                    `THR for ${r.items.filter((i) => i.eligible).length} employees, total ${n(r.total)}.`,
                  ),
              )
            }
          >
            {l("Hitung THR", "Compute THR")}
          </button>
          <button
            type="button"
            disabled={busy}
            title={l(
              "Selisih kenaikan upah berlaku mundur terhadap payroll yang sudah diposting",
              "Back pay for retroactive wage increases against posted payrolls",
            )}
            onClick={() =>
              summaryAction<{ total: string; items: unknown[] }>("retro", {}, (r) =>
                l(
                  `Rapel ${r.items.length} karyawan, total ${n(r.total)}.`,
                  `Back pay for ${r.items.length} employees, total ${n(r.total)}.`,
                ),
              )
            }
          >
            {l("Hitung rapel", "Compute back pay")}
          </button>
        </div>
      )}
      <p className="muted">
        {l("Periode", "Period")} {formatDate(run.periodStart, locale)} – {formatDate(run.periodEnd, locale)} ·{" "}
        {l("dibayar", "paid on")} {formatDate(run.paymentDate, locale)}
        {run.accountMove && (
          <>
            {" · "}
            {l("Jurnal", "Entry")}{" "}
            <Link href={`/accounting/moves/${run.accountMove.id}`}>{run.accountMove.name}</Link>
          </>
        )}
        {run.paymentMove && (
          <>
            {" · "}
            {l("Pembayaran", "Payment")}{" "}
            <Link href={`/accounting/moves/${run.paymentMove.id}`}>{run.paymentMove.name}</Link>
          </>
        )}
      </p>
      {(run.state === "done" || (run.state === "paid" && pendingHold.length > 0)) && manage && (
        <div className="inline-panel">
          <label className="field">
            <span>{l("Bayar dari", "Pay from")}</span>
            <select value={journalId} onChange={(e) => setJournalId(e.target.value)}>
              <option value="">—</option>
              {banks.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.code} {j.name}
                </option>
              ))}
            </select>
          </label>
          {run.state === "done" && (
            <button
              type="button"
              className="primary"
              disabled={!journalId || busy}
              onClick={() => act("pay", { journalId, date: run.paymentDate })}
            >
              {l(`Bayar gaji bersih ${n(payable)}`, `Pay net salaries ${n(payable)}`)}
            </button>
          )}
          {pendingHold.length > 0 && (
            <small className="muted">
              {l(
                `${pendingHold.length} gaji ditahan dibayar terpisah saat dilepas.`,
                `${pendingHold.length} held salaries are paid separately when released.`,
              )}
            </small>
          )}
        </div>
      )}
      <ul className="grid">
        {(
          [
            [l("Total pendapatan", "Total earnings"), run.totals.earnings],
            [l("PPh 21", "PPh 21"), run.totals.pph21],
            [l("BPJS Kesehatan — karyawan", "BPJS Health — employee"), run.totals.kesEmployee],
            [l("BPJS Kesehatan — perusahaan", "BPJS Health — employer"), run.totals.kesEmployer],
            [l("BPJS Ketenagakerjaan — karyawan", "BPJS Employment — employee"), run.totals.tkEmployee],
            [l("BPJS Ketenagakerjaan — perusahaan", "BPJS Employment — employer"), run.totals.tkEmployer],
            [l("Gaji bersih", "Net pay"), run.totals.net],
          ] as const
        ).map(([label, value]) => (
          <li key={label} className="card">
            <span>{label}</span>
            <strong>{n(value)}</strong>
          </li>
        ))}
      </ul>
      <TableTools view={table} placeholder={l("Cari karyawan, nomor…", "Search employee, number…")} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <SortTh view={table} col="employee">
                {l("Karyawan", "Employee")}
              </SortTh>
              <SortTh view={table} col="ptkp">
                PTKP / TER
              </SortTh>
              <SortTh view={table} col="unpaidDays" className="num">
                {l("Hari tak dibayar", "Unpaid days")}
              </SortTh>
              <SortTh view={table} col="earnings" className="num">
                {l("Pendapatan", "Earnings")}
              </SortTh>
              <SortTh view={table} col="gross" className="num">
                {l("Bruto PPh 21", "PPh 21 gross")}
              </SortTh>
              <SortTh view={table} col="pph21" className="num">
                PPh 21
              </SortTh>
              <SortTh view={table} col="kesEmployee" className="num">
                {l("BPJS Kesehatan", "BPJS Health")}
              </SortTh>
              <SortTh view={table} col="tkEmployee" className="num">
                {l("BPJS Ketenagakerjaan", "BPJS Employment")}
              </SortTh>
              <SortTh view={table} col="net" className="num">
                {l("Gaji bersih", "Net")}
              </SortTh>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/payroll/payslips/${p.id}`}>{p.employeeName}</Link>
                  <small className="muted">
                    {" "}
                    · {p.employeeNumber}
                    {p.departmentName ? ` · ${p.departmentName}` : ""}
                    {p.emailedAt ? ` · ${l("slip terkirim", "slip emailed")}` : ""}
                  </small>
                  {p.emailError && <small className="error"> {p.emailError}</small>}
                  {p.holdReason && (
                    <small className={p.releasedAt ? "muted" : "error"} title={p.holdReason}>
                      {" "}
                      {p.releasedAt
                        ? l("· ditahan, sudah dilepas", "· held, released")
                        : l("· ditahan", "· on hold")}
                    </small>
                  )}
                  {manage && run.state !== "cancel" && (
                    <span className="slip-actions">
                      {!p.holdReason && (run.state === "draft" || run.state === "done") && (
                        <button type="button" className="link" onClick={() => slipAction(p.id, "hold")}>
                          {l("Tahan gaji", "Hold salary")}
                        </button>
                      )}
                      {p.holdReason && !p.releasedAt && (run.state === "draft" || run.state === "done") && (
                        <button type="button" className="link" onClick={() => slipAction(p.id, "unhold")}>
                          {l("Batal tahan", "Unhold")}
                        </button>
                      )}
                      {p.holdReason && !p.releasedAt && (run.state === "done" || run.state === "paid") && (
                        <button type="button" className="link" onClick={() => slipAction(p.id, "release")}>
                          {l("Lepas & bayar", "Release & pay")}
                        </button>
                      )}
                    </span>
                  )}
                </td>
                <td>
                  {p.ptkpStatus} ·{" "}
                  {p.isFinal ? l("tahunan", "annual") : `${p.terCategory} ${Number(p.terRate ?? 0)}%`}
                </td>
                <td className="num">{Number(p.unpaidDays) || ""}</td>
                <td className="num">{n(p.earnings)}</td>
                <td className="num">{n(p.gross)}</td>
                <td className="num">{n(p.pph21)}</td>
                <td className="num">{n(p.kesEmployee)}</td>
                <td className="num">{n(p.tkEmployee)}</td>
                <td className="num">
                  <strong>{n(p.net)}</strong>
                </td>
              </tr>
            ))}
            {table.rows.length === 0 && (
              <tr>
                <td colSpan={9} className="muted">
                  {run.payslips.length
                    ? l("Tidak ada data yang cocok dengan filter.", "No rows match the filters.")
                    : l(
                        "Tidak ada karyawan dengan kontrak berjalan pada periode ini.",
                        "No employees with a running contract in this period.",
                      )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <TablePager view={table} />
      {id && id !== "new" && <RelatedDocuments model="payroll_run" id={id} />}
    </div>
  );
}
