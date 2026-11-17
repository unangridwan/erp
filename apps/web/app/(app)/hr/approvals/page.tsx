"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useMe } from "../../../../components/me-context";
import { api, ApiError } from "../../../../lib/api";
import { money } from "../../../../lib/format";
import { can } from "../../../../lib/resources";
import { useI18n } from "../../../../lib/i18n";
import { SortTh, TablePager, TableTools, type ViewColumn } from "../../../../components/data-table";
import { useTableView } from "../../../../lib/use-table-view";

interface Pending {
  model:
    | "leave_request"
    | "overtime"
    | "expense_claim"
    | "approval_request"
    | "attendance_request"
    | "shift_request"
    | "purchase_order";
  id: string;
  employeeName: string;
  summary: string;
  step: number;
  levels: number;
  mine: boolean;
  /** Lembur: jam diajukan & batas yang boleh disetujui (hasil hitung absensi). */
  overtime?: { hours: string; maxHours: string; source: "manual" | "attendance"; dayType: string };
}
interface Status {
  waitingFor: string | null;
  history: {
    step: number;
    decision: string;
    note: string | null;
    createdAt: string;
    userName: string | null;
  }[];
}

/** PO menunggu persetujuan (dari modul Pembelian). */
interface PendingPo {
  id: string;
  name: string;
  partnerName: string;
  amountTotal: string;
  currencyCode: string;
  step: number;
  levels: number;
}

/**
 * Kotak persetujuan: cuti, lembur, klaim, koreksi absensi, tukar shift, permintaan persetujuan (termasuk payroll run,
 * SK mutasi, payment run, dll.), dan PO yang menunggu keputusan user ini.
 */
export default function ApprovalsPage() {
  const { l, locale } = useI18n();
  const [rows, setRows] = useState<Pending[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [hours, setHours] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<Record<string, Status>>({});
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const me = useMe();
  const canPo = can(me.permissions, "purchase.read");
  useEffect(() => {
    const po = canPo
      ? api<PendingPo[]>("/purchase-orders/pending-approval").catch(() => [] as PendingPo[])
      : Promise.resolve([] as PendingPo[]);
    Promise.all([api<Pending[]>("/approvals/pending"), po])
      .then(([hr, orders]) =>
        setRows([
          ...hr,
          ...orders.map((o): Pending => ({
            model: "purchase_order",
            id: o.id,
            employeeName: o.partnerName,
            summary: `${o.name} — ${money(o.amountTotal, locale)}${o.currencyCode === "IDR" ? "" : ` ${o.currencyCode}`}`,
            step: o.step,
            levels: o.levels,
            mine: true,
          })),
        ]),
      )
      .catch((e: Error) => setError(e.message));
  }, [version, canPo, locale]);

  const columns = useMemo<ViewColumn<Pending>[]>(() => {
    const kind: Record<Pending["model"], string> = {
      leave_request: l("Cuti", "Time off"),
      overtime: l("Lembur", "Overtime"),
      expense_claim: l("Klaim biaya", "Expense claim"),
      approval_request: l("Permintaan", "Request"),
      attendance_request: l("Koreksi absensi", "Attendance correction"),
      shift_request: l("Tukar shift", "Shift change"),
      purchase_order: l("Pesanan pembelian", "Purchase order"),
    };
    return [
      {
        key: "model",
        label: l("Jenis", "Type"),
        type: "enum",
        value: (r) => r.model,
        optionLabel: (v) => kind[v as Pending["model"]] ?? v,
      },
      { key: "employee", label: l("Pengaju / pihak", "Requester / party"), value: (r) => r.employeeName },
      { key: "summary", label: l("Pengajuan", "Request"), value: (r) => r.summary },
      { key: "step", label: l("Tahap", "Step"), type: "number", value: (r) => r.step },
    ];
  }, [l]);
  const table = useTableView(rows ?? [], columns, { storageKey: "approvals-pending" });

  async function decide(r: Pending, decision: "approve" | "refuse") {
    setError(null);
    const path =
      r.model === "purchase_order"
        ? `/purchase-orders/${r.id}/approve`
        : r.model === "approval_request"
          ? `/approval-requests/${r.id}/${decision}`
          : r.model === "attendance_request"
            ? `/attendance-requests/${r.id}/${decision}`
            : r.model === "shift_request"
              ? `/shift-requests/${r.id}/${decision}`
              : r.model === "leave_request"
                ? `/leaves/${r.id}/${decision}`
                : r.model === "expense_claim"
                  ? `/expense-claims/${r.id}/${decision}`
                  : `/approvals/overtime/${r.id}/${decision}`;
    try {
      const approvedHours = r.overtime && decision === "approve" ? hours[r.id] : undefined;
      await api(path, {
        method: "POST",
        body: { note: notes[r.id] || null, ...(approvedHours ? { hours: Number(approvedHours) } : {}) },
      });
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }
  async function toggleHistory(r: Pending) {
    if (history[r.id]) {
      setHistory(({ [r.id]: _, ...rest }) => rest);
      return;
    }
    if (r.model === "approval_request") {
      const d = await api<{
        steps: {
          sequence: number;
          state: string;
          note: string | null;
          decidedAt: string | null;
          decidedByName: string | null;
          approverName: string | null;
        }[];
      }>(`/approval-requests/${r.id}`);
      const decided = d.steps.filter((x) => x.state === "approved" || x.state === "refused");
      setHistory((h) => ({
        ...h,
        [r.id]: {
          waitingFor: null,
          history: decided.map((x) => ({
            step: x.sequence,
            decision: x.state,
            note: x.note,
            createdAt: x.decidedAt ?? "",
            userName: x.decidedByName ?? x.approverName,
          })),
        },
      }));
      return;
    }
    const s = await api<Status>(`/approvals/${r.model}/${r.id}`);
    setHistory((h) => ({ ...h, [r.id]: s }));
  }
  const time = (v: string) =>
    new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(v));

  return (
    <>
      <header className="toolbar">
        <h1>{l("Persetujuan", "Approvals")}</h1>
      </header>
      <p className="muted">
        {l(
          "Cuti, lembur, dan klaim: tahap 1 atasan langsung, tahap 2 atasan dari atasan, tahap 3 HR (jumlah tahap di Pengaturan Payroll). Lembur dari absensi bisa dikurangi jamnya sebelum disetujui. Permintaan persetujuan mengikuti penyetuju kategorinya. Delegasi yang aktif ikut tampil di sini.",
          "Time off, overtime and claims: step 1 is the direct manager, step 2 the manager's manager, step 3 HR (number of steps in Payroll Settings). Overtime from attendance can be reduced before approving. Approval requests follow their category's approvers. Active delegations show up here too.",
        )}
      </p>
      {error && <p className="error">{error}</p>}
      {rows && <TableTools view={table} />}
      {rows && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <SortTh view={table} col="model">
                  {l("Jenis", "Type")}
                </SortTh>
                <SortTh view={table} col="employee">
                  {l("Pengaju / pihak", "Requester / party")}
                </SortTh>
                <SortTh view={table} col="summary">
                  {l("Pengajuan", "Request")}
                </SortTh>
                <SortTh view={table} col="step">
                  {l("Tahap", "Step")}
                </SortTh>
                <th>{l("Catatan", "Note")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <Fragment key={r.id}>
                  <tr>
                    <td>
                      {r.model === "attendance_request" || r.model === "shift_request" ? (
                        <Link href="/hr/attendance-requests">
                          {r.model === "attendance_request"
                            ? l("Koreksi absensi", "Attendance correction")
                            : l("Tukar shift", "Shift change")}
                        </Link>
                      ) : r.model === "approval_request" ? (
                        <Link href={`/hr/approval-requests/${r.id}`}>{l("Permintaan", "Request")}</Link>
                      ) : r.model === "purchase_order" ? (
                        <Link href={`/purchase/orders/${r.id}`}>
                          {l("Pesanan pembelian", "Purchase order")}
                        </Link>
                      ) : r.model === "leave_request" ? (
                        l("Cuti", "Time off")
                      ) : r.model === "expense_claim" ? (
                        <Link href={`/hr/expenses/${r.id}`}>{l("Klaim biaya", "Expense claim")}</Link>
                      ) : (
                        l("Lembur", "Overtime")
                      )}
                    </td>
                    <td>{r.employeeName}</td>
                    <td>
                      {r.summary}
                      {r.overtime && (
                        <label className="ot-hours">
                          <span>
                            {l("Jam disetujui", "Approved hours")}
                            {r.overtime.source === "attendance" && (
                              <> ({l("dari absensi", "from attendance")})</>
                            )}
                          </span>
                          <input
                            className="num"
                            type="number"
                            min="0.5"
                            step="0.5"
                            max={Number(r.overtime.maxHours)}
                            value={hours[r.id] ?? String(Number(r.overtime.hours))}
                            onChange={(e) => setHours((h) => ({ ...h, [r.id]: e.target.value }))}
                          />
                          <small className="muted">
                            {l(
                              `maks. ${Number(r.overtime.maxHours)} jam`,
                              `max ${Number(r.overtime.maxHours)} h`,
                            )}
                          </small>
                        </label>
                      )}
                    </td>
                    <td>
                      {r.step}/{r.levels}{" "}
                      {!r.mine && <span className="badge state-draft">{l("sebagai HR", "as HR")}</span>}
                    </td>
                    <td>
                      <input
                        aria-label={l("Catatan", "Note")}
                        value={notes[r.id] ?? ""}
                        onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                      />
                    </td>
                    <td>
                      <button type="button" className="link" onClick={() => decide(r, "approve")}>
                        {l("Setujui", "Approve")}
                      </button>{" "}
                      {r.model === "purchase_order" ? (
                        // PO ditolak dengan membatalkannya di halaman PO (riwayat tahap ada di sana).
                        <Link href={`/purchase/orders/${r.id}`}>{l("Buka PO", "Open PO")}</Link>
                      ) : (
                        <>
                          <button type="button" className="link" onClick={() => decide(r, "refuse")}>
                            {l("Tolak", "Refuse")}
                          </button>{" "}
                          <button type="button" className="link" onClick={() => toggleHistory(r)}>
                            {l("Riwayat", "History")}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                  {history[r.id] && (
                    <tr>
                      <td colSpan={6} className="muted">
                        {history[r.id]!.history.length === 0
                          ? l("Belum ada keputusan.", "No decisions yet.")
                          : history[r.id]!.history.map((h) => (
                              <div key={h.createdAt}>
                                {l("Tahap", "Step")} {h.step}: {h.userName ?? "—"} —{" "}
                                {h.decision === "approved"
                                  ? l("disetujui", "approved")
                                  : l("ditolak", "refused")}{" "}
                                ({time(h.createdAt)}){h.note ? ` — ${h.note}` : ""}
                              </div>
                            ))}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {table.rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    {rows.length
                      ? l("Tidak ada data yang cocok dengan filter.", "No rows match the filters.")
                      : l("Tidak ada pengajuan yang menunggu Anda.", "Nothing is waiting for you.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {rows && <TablePager view={table} />}
    </>
  );
}
