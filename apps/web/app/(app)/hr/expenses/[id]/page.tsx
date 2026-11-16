"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { download } from "../../../../../components/accounting/download";
import { useOptions } from "../../../../../components/accounting/use-options";
import { ExpenseClaimForm } from "../../../../../components/hr/expense-form";
import { useMe } from "../../../../../components/me-context";
import { api, ApiError } from "../../../../../lib/api";
import { formatDate, money, today } from "../../../../../lib/format";
import { useI18n } from "../../../../../lib/i18n";
import { can, EXPENSE_STATE_LABEL } from "../../../../../lib/resources";
import { ask } from "../../../../../components/feedback";
import { RelatedDocuments } from "../../../../../components/related-documents";

interface Claim {
  id: string;
  name: string;
  employeeId: string;
  employeeName: string;
  date: string;
  description: string | null;
  state: string;
  payMethod: "payslip" | "cash";
  total: string;
  payslipId: string | null;
  move: { id: string; name: string | null } | null;
  lines: {
    id: string;
    categoryId: string;
    categoryName: string;
    date: string;
    amount: string;
    note: string | null;
    attachmentName: string | null;
  }[];
  approval: {
    step: number;
    levels: number;
    waitingFor: string | null;
    history: {
      step: number;
      decision: string;
      note: string | null;
      userName: string | null;
      createdAt: string;
    }[];
  } | null;
}

/** Detail klaim biaya: baris & bukti, riwayat persetujuan, setujui/tolak, bayar dari kas/bank. */
export default function ExpenseClaimPage() {
  const { id } = useParams<{ id: string }>();
  const { l, tx, locale } = useI18n();
  const me = useMe();
  const journals = useOptions<{ id: string; code: string; name: string; journalType: string }>(
    can(me.permissions, "payroll.manage") ? "/journals" : null,
  );
  const [claim, setClaim] = useState<Claim | null>(null);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [note, setNote] = useState("");
  const [journalId, setJournalId] = useState("");
  const [payDate, setPayDate] = useState(today());
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => api<Claim>(`/expense-claims/${id}`).then(setClaim, (e: Error) => setError(e.message));
  useEffect(() => {
    void load();
    api<{ id: string; name: string }[]>("/me/expense-categories").then(setCategories, () =>
      setCategories([]),
    );
  }, [id]);

  async function act(path: string, body: object = {}) {
    setError(null);
    try {
      setClaim(await api<Claim>(`/expense-claims/${id}/${path}`, { method: "POST", body }));
      setNote("");
    } catch (e) {
      setError(e instanceof ApiError ? (Object.values(e.fieldErrors)[0] ?? e.message) : String(e));
    }
  }

  if (!claim) return <p className="muted">{error ?? l("Memuat…", "Loading…")}</p>;
  const n = (v: string) => money(v, locale);
  const banks = journals.filter((j) => j.journalType === "bank" || j.journalType === "cash");

  return (
    <div className="panel">
      <header className="toolbar">
        <h1>
          {claim.name} — {claim.employeeName}
        </h1>
        <span className={`badge state-${claim.state === "paid" ? "sale" : claim.state}`}>
          {tx(EXPENSE_STATE_LABEL[claim.state]!)}
        </span>
        {claim.state === "draft" && (
          <>
            <button type="button" onClick={() => setEditing(true)}>
              {l("Ubah", "Edit")}
            </button>
            <button type="button" className="primary" onClick={() => act("submit")}>
              {l("Ajukan", "Submit")}
            </button>
          </>
        )}
        {["draft", "confirm", "approved", "refused"].includes(claim.state) && (
          <button
            type="button"
            className="danger"
            onClick={async () => (await ask(l("Batalkan klaim ini?", "Cancel this claim?"))) && act("cancel")}
          >
            {l("Batalkan", "Cancel")}
          </button>
        )}
      </header>
      {error && <p className="error">{error}</p>}
      <p className="muted">
        {formatDate(claim.date, locale)}
        {claim.description ? ` · ${claim.description}` : ""} ·{" "}
        {claim.payMethod === "cash"
          ? l("dibayar langsung dari kas/bank", "paid directly from cash/bank")
          : l("dibayar bersama gaji", "paid with the payslip")}
        {claim.payslipId && (
          <>
            {" · "}
            <Link href={`/payroll/payslips/${claim.payslipId}`}>{l("Slip gaji", "Payslip")}</Link>
          </>
        )}
        {claim.move && (
          <>
            {" · "}
            <Link href={`/accounting/moves/${claim.move.id}`}>{claim.move.name}</Link>
          </>
        )}
      </p>
      {editing ? (
        <ExpenseClaimForm
          categories={categories}
          claimId={claim.id}
          initial={{
            date: claim.date,
            description: claim.description ?? "",
            payMethod: claim.payMethod,
            lines: claim.lines.map((x) => ({
              id: x.id,
              categoryId: x.categoryId,
              date: x.date,
              amount: String(Number(x.amount)),
              note: x.note ?? "",
              attachmentName: x.attachmentName,
            })),
          }}
          onSaved={() => {
            setEditing(false);
            void load();
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="table-scroll">
          <table className="lines">
            <thead>
              <tr>
                <th>{l("Kategori", "Category")}</th>
                <th>{l("Tanggal", "Date")}</th>
                <th>{l("Catatan", "Note")}</th>
                <th>{l("Bukti", "Receipt")}</th>
                <th className="num">{l("Jumlah", "Amount")}</th>
              </tr>
            </thead>
            <tbody>
              {claim.lines.map((x) => (
                <tr key={x.id}>
                  <td>{x.categoryName}</td>
                  <td>{formatDate(x.date, locale)}</td>
                  <td>{x.note}</td>
                  <td>
                    {x.attachmentName && (
                      <button
                        type="button"
                        className="link"
                        onClick={() =>
                          download(
                            `/expense-claims/${claim.id}/lines/${x.id}/attachment`,
                            x.attachmentName!,
                          ).catch((e: Error) => setError(e.message))
                        }
                      >
                        {x.attachmentName}
                      </button>
                    )}
                  </td>
                  <td className="num">{n(x.amount)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={4}>
                  <strong>{l("Total", "Total")}</strong>
                </td>
                <td className="num">
                  <strong>{n(claim.total)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {claim.approval && (
        <>
          <h2>{l("Persetujuan", "Approval")}</h2>
          <p className="muted">
            {l("Tahap", "Step")} {claim.approval.step}/{claim.approval.levels}
            {claim.approval.waitingFor
              ? ` · ${l("menunggu", "waiting for")} ${claim.approval.waitingFor}`
              : ""}
          </p>
          <ul>
            {claim.approval.history.map((h, i) => (
              <li key={i}>
                {l("Tahap", "Step")} {h.step}:{" "}
                {h.decision === "approved" ? l("disetujui", "approved") : l("ditolak", "refused")}{" "}
                {l("oleh", "by")} {h.userName ?? "—"}
                {h.note ? ` — ${h.note}` : ""}
              </li>
            ))}
          </ul>
          {claim.state === "confirm" && (
            <div className="inline-panel">
              <label className="field">
                <span>{l("Catatan", "Note")}</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
              <button
                type="button"
                className="primary"
                onClick={() => act("approve", { note: note || null })}
              >
                {l("Setujui", "Approve")}
              </button>
              <button type="button" className="danger" onClick={() => act("refuse", { note: note || null })}>
                {l("Tolak", "Refuse")}
              </button>
            </div>
          )}
        </>
      )}
      {claim.state === "approved" && claim.payMethod === "cash" && can(me.permissions, "payroll.manage") && (
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
          <label className="field">
            <span>{l("Tanggal", "Date")}</span>
            <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
          </label>
          <button
            type="button"
            className="primary"
            disabled={!journalId}
            onClick={() => act("pay", { journalId, date: payDate })}
          >
            {l(`Bayar ${n(claim.total)}`, `Pay ${n(claim.total)}`)}
          </button>
        </div>
      )}
      {claim.state === "approved" && claim.payMethod === "payslip" && (
        <p className="notice">
          {l(
            "Klaim akan dibayar otomatis pada payroll berikutnya (setelah payroll dihitung & diposting).",
            "The claim will be paid automatically on the next payroll (once computed & posted).",
          )}
        </p>
      )}
      {id && id !== "new" && <RelatedDocuments model="expense_claim" id={id} />}
    </div>
  );
}
