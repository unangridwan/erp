"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useState, type FormEvent } from "react";
import { useOptions } from "../accounting/use-options";
import { ask } from "../feedback";
import { RefSelect } from "../ref-select";
import { api, ApiError } from "../../lib/api";
import { formatDate, money, today } from "../../lib/format";
import { L, useI18n, type Text } from "../../lib/i18n";

export interface Advance {
  id: string;
  name: string;
  employeeId: string;
  employeeName: string;
  date: string;
  purpose: string;
  amount: string;
  settleBy: string;
  state: string;
  claimed: string;
  remainder: string;
  remainderMethod: "return" | "payslip" | null;
  settlementDate: string | null;
  disbursementDate: string | null;
  awaitingPayslip: boolean;
  overdue: boolean;
}
interface AdvanceDetail extends Advance {
  claims: { id: string; name: string; date: string; state: string; total: string }[];
  approval: { id: string; number: string | null; state: string } | null;
  disbursementMove: { id: string; name: string | null } | null;
  settlementMove: { id: string; name: string | null } | null;
  settlement: { claims: string; used: string; payOut: string; remainder: string };
}

export const ADVANCE_STATE: Record<string, Text> = {
  draft: L("Draft", "Draft"),
  confirm: L("Menunggu persetujuan", "Awaiting approval"),
  approved: L("Disetujui", "Approved"),
  refused: L("Ditolak", "Refused"),
  paid: L("Dicairkan", "Disbursed"),
  settled: L("Selesai", "Settled"),
  cancel: L("Batal", "Cancelled"),
};
const BADGE: Record<string, string> = {
  draft: "draft",
  confirm: "sent",
  approved: "sent",
  refused: "cancel",
  paid: "sent",
  settled: "sale",
  cancel: "cancel",
};

const errorText = (e: unknown) =>
  e instanceof ApiError
    ? (Object.values(e.fieldErrors)[0] ?? e.message)
    : e instanceof Error
      ? e.message
      : String(e);

const plusDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/** Status kasbon, termasuk "menunggu potong gaji" & "lewat batas". */
export function AdvanceStatus({ a }: { a: Advance }) {
  const { l, tx } = useI18n();
  return (
    <>
      <span className={`badge state-${BADGE[a.state] ?? a.state}`}>
        {a.awaitingPayslip
          ? l("Menunggu potong gaji", "Awaiting payslip deduction")
          : a.state === "paid" && a.settlementDate
            ? tx(ADVANCE_STATE.settled!)
            : tx(ADVANCE_STATE[a.state] ?? L(a.state, a.state))}
      </span>
      {a.overdue && <span className="badge danger">{l("Lewat batas", "Overdue")}</span>}
    </>
  );
}

/** Form pengajuan kasbon (portal: untuk diri sendiri; HR: pilih karyawan). */
function AdvanceForm(props: { chooseEmployee: boolean; onSaved: () => void; onCancel?: () => void }) {
  const { l } = useI18n();
  const [form, setForm] = useState({
    employeeId: "",
    date: today(),
    purpose: "",
    amount: "",
    settleBy: plusDays(today(), 14),
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent, submit: boolean) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { employeeId, ...rest } = form;
      const adv = await api<{ id: string }>("/employee-advances", {
        method: "POST",
        body: { ...rest, ...(props.chooseEmployee && employeeId ? { employeeId } : {}) },
      });
      if (submit) await api(`/employee-advances/${adv.id}/submit`, { method: "POST" });
      setForm((f) => ({ ...f, purpose: "", amount: "" }));
      props.onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="stack" onSubmit={(e) => save(e, true)}>
      <div className="inline-panel">
        {props.chooseEmployee && (
          <label className="field">
            <span>{l("Karyawan *", "Employee *")}</span>
            <RefSelect
              name="employeeId"
              resource="employees"
              display="name"
              required
              value={form.employeeId}
              onChange={(v) => setForm((f) => ({ ...f, employeeId: v }))}
            />
          </label>
        )}
        <label className="field">
          <span>{l("Tanggal", "Date")}</span>
          <input
            type="date"
            required
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
          />
        </label>
        <label className="field grow">
          <span>{l("Keperluan *", "Purpose *")}</span>
          <input
            required
            minLength={3}
            value={form.purpose}
            onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
          />
        </label>
        <label className="field">
          <span>{l("Jumlah *", "Amount *")}</span>
          <input
            className="num"
            inputMode="decimal"
            required
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value.replace(/[^\d.]/g, "") }))}
          />
        </label>
        <label className="field">
          <span>{l("Batas pertanggungjawaban", "Settle by")}</span>
          <input
            type="date"
            required
            min={form.date}
            value={form.settleBy}
            onChange={(e) => setForm((f) => ({ ...f, settleBy: e.target.value }))}
          />
        </label>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" disabled={busy} onClick={(e) => save(e as unknown as FormEvent, false)}>
          {l("Simpan draft", "Save draft")}
        </button>
        <button className="primary" disabled={busy}>
          {l("Simpan & ajukan", "Save & submit")}
        </button>
        {props.onCancel && (
          <button type="button" className="link" onClick={props.onCancel}>
            {l("Batal", "Cancel")}
          </button>
        )}
      </div>
    </form>
  );
}

/** Rincian & tindakan satu kasbon: ajukan/batalkan, cairkan & selesaikan (payroll.manage), klaim terkait. */
function AdvanceDetailPanel(props: { id: string; manage: boolean; onChanged: () => void }) {
  const { l, tx, locale } = useI18n();
  const journals = useOptions<{ id: string; code: string; name: string; journalType: string }>(
    props.manage ? "/journals" : null,
  );
  const cash = journals.filter((j) => j.journalType === "bank" || j.journalType === "cash");
  const [d, setD] = useState<AdvanceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pay, setPay] = useState({ journalId: "", date: today() });
  const [settle, setSettle] = useState({
    journalId: "",
    date: today(),
    remainderMethod: "return" as "return" | "payslip",
  });
  const load = useCallback(
    () => api<AdvanceDetail>(`/employee-advances/${props.id}`).then(setD, (e) => setError(errorText(e))),
    [props.id],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const act = async (path: string, body?: object) => {
    setError(null);
    try {
      await api(`/employee-advances/${props.id}/${path}`, { method: "POST", body });
      await load();
      props.onChanged();
    } catch (e) {
      setError(errorText(e));
    }
  };
  if (!d)
    return error ? <p className="error">{error}</p> : <p className="muted">{l("Memuat…", "Loading…")}</p>;
  const s = d.settlement;
  const open = d.state === "paid" && !d.settlementDate;
  const needsCash = Number(s.payOut) > 0 || (Number(s.remainder) > 0 && settle.remainderMethod === "return");
  return (
    <div className="stack advance-detail">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="muted">
        {d.purpose} · {l("batas pertanggungjawaban", "settle by")} {formatDate(d.settleBy, locale)}
        {d.approval && (
          <>
            {" · "}
            <Link href={`/hr/approval-requests/${d.approval.id}`}>
              {l("Persetujuan", "Approval")} {d.approval.number ?? ""}
            </Link>
          </>
        )}
        {d.disbursementMove && (
          <>
            {" · "}
            {l("Dicairkan", "Disbursed")} {formatDate(d.disbursementDate!, locale)}{" "}
            <Link href={`/accounting/moves/${d.disbursementMove.id}`}>{d.disbursementMove.name}</Link>
          </>
        )}
        {d.settlementMove && (
          <>
            {" · "}
            {l("Diselesaikan", "Settled")}{" "}
            <Link href={`/accounting/moves/${d.settlementMove.id}`}>{d.settlementMove.name}</Link>
          </>
        )}
      </p>
      {d.state === "draft" && (
        <div className="form-actions">
          <button type="button" className="primary" onClick={() => act("submit")}>
            {l("Ajukan persetujuan", "Submit for approval")}
          </button>
        </div>
      )}
      {d.claims.length > 0 ? (
        <div className="table-scroll">
          <table className="lines">
            <thead>
              <tr>
                <th>{l("Klaim pertanggungjawaban", "Settlement claims")}</th>
                <th>{l("Tanggal", "Date")}</th>
                <th>{l("Status", "Status")}</th>
                <th className="num">{l("Jumlah", "Amount")}</th>
              </tr>
            </thead>
            <tbody>
              {d.claims.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/hr/expenses/${c.id}`}>{c.name}</Link>
                  </td>
                  <td>{formatDate(c.date, locale)}</td>
                  <td>{c.state}</td>
                  <td className="num">{money(c.total, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        d.state === "paid" && (
          <p className="muted">
            {l(
              'Belum ada klaim. Buat klaim biaya dan pilih kasbon ini pada "Pertanggungjawaban kasbon".',
              'No claims yet. Create an expense claim and choose this advance under "Cash advance settlement".',
            )}
          </p>
        )
      )}
      {(open || d.settlementDate) && (
        <dl className="advance-summary">
          <div>
            <dt>{l("Kasbon", "Advance")}</dt>
            <dd className="num">{money(d.amount, locale)}</dd>
          </div>
          <div>
            <dt>{l("Klaim disetujui", "Approved claims")}</dt>
            <dd className="num">{money(s.claims, locale)}</dd>
          </div>
          {Number(s.payOut) > 0 && (
            <div>
              <dt>{l("Dibayar ke karyawan", "Paid to employee")}</dt>
              <dd className="num">{money(s.payOut, locale)}</dd>
            </div>
          )}
          {Number(open ? s.remainder : d.remainder) > 0 && (
            <div>
              <dt>{l("Sisa kasbon", "Remaining advance")}</dt>
              <dd className="num">
                {money(open ? s.remainder : d.remainder, locale)}
                {d.remainderMethod &&
                  ` · ${d.remainderMethod === "payslip" ? l("potong gaji", "payslip deduction") : l("dikembalikan", "returned")}`}
              </dd>
            </div>
          )}
        </dl>
      )}
      {props.manage && d.state === "approved" && (
        <div className="inline-panel">
          <label className="field">
            <span>{l("Dicairkan dari", "Paid from")}</span>
            <select
              value={pay.journalId}
              onChange={(e) => setPay((p) => ({ ...p, journalId: e.target.value }))}
            >
              <option value="">—</option>
              {cash.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.code} {j.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{l("Tanggal", "Date")}</span>
            <input
              type="date"
              value={pay.date}
              onChange={(e) => setPay((p) => ({ ...p, date: e.target.value }))}
            />
          </label>
          <button
            type="button"
            className="primary"
            disabled={!pay.journalId}
            onClick={() => act("disburse", pay)}
          >
            {l(`Cairkan ${money(d.amount, locale)}`, `Disburse ${money(d.amount, locale)}`)}
          </button>
        </div>
      )}
      {props.manage && open && (
        <div className="inline-panel">
          {Number(s.remainder) > 0 && (
            <label className="field">
              <span>{l("Sisa kasbon", "Remaining advance")}</span>
              <select
                value={settle.remainderMethod}
                onChange={(e) =>
                  setSettle((p) => ({ ...p, remainderMethod: e.target.value as "return" | "payslip" }))
                }
              >
                <option value="return">{l("Dikembalikan tunai", "Returned in cash")}</option>
                <option value="payslip">
                  {l("Dipotong di gaji berikutnya", "Deducted from next payslip")}
                </option>
              </select>
            </label>
          )}
          {needsCash && (
            <label className="field">
              <span>{l("Kas/bank", "Cash/bank")}</span>
              <select
                value={settle.journalId}
                onChange={(e) => setSettle((p) => ({ ...p, journalId: e.target.value }))}
              >
                <option value="">—</option>
                {cash.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.code} {j.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span>{l("Tanggal", "Date")}</span>
            <input
              type="date"
              value={settle.date}
              onChange={(e) => setSettle((p) => ({ ...p, date: e.target.value }))}
            />
          </label>
          <button
            type="button"
            className="primary"
            disabled={needsCash && !settle.journalId}
            onClick={() => act("settle", { ...settle, journalId: needsCash ? settle.journalId : null })}
          >
            {l("Selesaikan kasbon", "Settle advance")}
          </button>
        </div>
      )}
      {["draft", "confirm", "approved"].includes(d.state) && (
        <div>
          <button
            type="button"
            className="danger"
            onClick={async () =>
              (await ask(l("Batalkan kasbon ini?", "Cancel this advance?"))) && act("cancel")
            }
          >
            {l("Batalkan kasbon", "Cancel advance")}
          </button>
        </div>
      )}
      <p className="muted small">{tx(ADVANCE_STATE[d.state] ?? L(d.state, d.state))}</p>
    </div>
  );
}

/**
 * Daftar kasbon dengan rincian yang bisa dibuka. `mine` = portal karyawan (kasbon sendiri); selain itu semua kasbon
 * perusahaan (HR/payroll), dengan pilihan karyawan saat membuat.
 */
export function AdvanceList(props: {
  mine?: boolean;
  canCreate: boolean;
  chooseEmployee?: boolean;
  manage?: boolean;
  initialOpen?: string | null;
}) {
  const { l, tx, locale } = useI18n();
  const [rows, setRows] = useState<Advance[] | null>(null);
  const [state, setState] = useState("");
  const [openId, setOpenId] = useState<string | null>(props.initialOpen ?? null);
  const [creating, setCreating] = useState(false);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams({ ...(props.mine ? { mine: "1" } : {}), ...(state ? { state } : {}) });
    api<Advance[]>(`/employee-advances?${q}`).then(setRows, (e) => setError(errorText(e)));
  }, [props.mine, state, version]);
  const cols = props.mine ? 6 : 7;
  return (
    <div className="stack">
      <div className="toolbar">
        <select aria-label={l("Status", "Status")} value={state} onChange={(e) => setState(e.target.value)}>
          <option value="">{l("Semua status", "All states")}</option>
          <option value="open">{l("Masih berjalan", "Open")}</option>
          {["draft", "confirm", "approved", "paid", "settled", "refused", "cancel"].map((s) => (
            <option key={s} value={s}>
              {tx(ADVANCE_STATE[s]!)}
            </option>
          ))}
        </select>
        {props.canCreate && !creating && (
          <button type="button" className="primary" onClick={() => setCreating(true)}>
            {l("Ajukan kasbon", "New cash advance")}
          </button>
        )}
      </div>
      {creating && (
        <AdvanceForm
          chooseEmployee={!!props.chooseEmployee}
          onSaved={() => {
            setCreating(false);
            setVersion((v) => v + 1);
          }}
          onCancel={() => setCreating(false)}
        />
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {rows && rows.length === 0 && (
        <p className="muted">{l("Belum ada kasbon.", "No cash advances yet.")}</p>
      )}
      {rows && rows.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{l("Nomor", "Number")}</th>
                {!props.mine && <th>{l("Karyawan", "Employee")}</th>}
                <th>{l("Keperluan", "Purpose")}</th>
                <th>{l("Tanggal", "Date")}</th>
                <th className="num">{l("Kasbon", "Advance")}</th>
                <th className="num">{l("Diklaim", "Claimed")}</th>
                <th>{l("Status", "Status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <Fragment key={a.id}>
                  <tr>
                    <td>
                      <button
                        type="button"
                        className="link"
                        aria-expanded={openId === a.id}
                        onClick={() => setOpenId(openId === a.id ? null : a.id)}
                      >
                        {openId === a.id ? "▾" : "▸"} {a.name}
                      </button>
                    </td>
                    {!props.mine && <td>{a.employeeName}</td>}
                    <td>{a.purpose}</td>
                    <td>{formatDate(a.date, locale)}</td>
                    <td className="num">{money(a.amount, locale)}</td>
                    <td className="num">{money(a.claimed, locale)}</td>
                    <td>
                      <AdvanceStatus a={a} />
                    </td>
                  </tr>
                  {openId === a.id && (
                    <tr>
                      <td colSpan={cols}>
                        <AdvanceDetailPanel
                          id={a.id}
                          manage={!!props.manage}
                          onChanged={() => setVersion((v) => v + 1)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Portal karyawan: kasbon saya. */
export function MyAdvances() {
  const { l } = useI18n();
  return (
    <section className="panel">
      <h2>{l("Kasbon", "Cash advances")}</h2>
      <p className="muted small">
        {l(
          "Ajukan uang muka untuk keperluan kerja; setelah dicairkan, pertanggungjawabkan dengan klaim biaya sebelum batasnya.",
          "Request an advance for work expenses; once disbursed, settle it with expense claims before the deadline.",
        )}
      </p>
      <AdvanceList mine canCreate />
    </section>
  );
}
