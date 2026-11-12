"use client";

import { BANK_FORMATS } from "@erp/shared";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useState } from "react";
import { download } from "../../../../../components/accounting/download";
import { ask, toast } from "../../../../../components/feedback";
import { useMe } from "../../../../../components/me-context";
import { api } from "../../../../../lib/api";
import { formatDate, money } from "../../../../../lib/format";
import { useI18n } from "../../../../../lib/i18n";
import { can } from "../../../../../lib/resources";
import { RUN_STATE } from "../../../../../components/accounting/payment-run-state";

interface Bank {
  id: string;
  bankName: string;
  accountNumber: string;
  accountHolder: string;
}
interface Line {
  id: string;
  partnerId: string;
  partnerName: string;
  bankAccountId: string | null;
  moveId: string;
  moveName: string;
  ref: string | null;
  dueDate: string | null;
  date: string;
  residual: string;
  amount: string;
  included: boolean;
  state: "pending" | "paid" | "failed";
  error: string | null;
  banks: Bank[];
}
interface Group {
  partnerId: string;
  partnerName: string;
  bankAccount: Bank | null;
  bills: number;
  total: string;
  state: "pending" | "paid" | "failed";
}
interface Run {
  id: string;
  name: string;
  state: string;
  paymentDate: string;
  dueUntil: string;
  total: string;
  journal: { code: string; name: string; bankAccountNumber: string | null } | null;
  approvalRequest: { id: string; number: string | null; state: string } | null;
  lines: Line[];
  groups: Group[];
  warnings: string[];
}
const FORMAT_LABEL: Record<string, string> = {
  bca: "BCA",
  mandiri: "Mandiri",
  bri: "BRI",
  bni: "BNI",
  csv: "CSV",
};

export default function PaymentRunPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const { l, locale } = useI18n();
  const m = (v: string) => money(v, locale);
  const [run, setRun] = useState<Run | null>(null);
  const [draft, setDraft] = useState<
    Record<string, { included: boolean; amount: string; bankAccountId: string | null }>
  >({});
  const [busy, setBusy] = useState(false);
  const write = can(me.permissions, "accounting.write");
  const post = can(me.permissions, "accounting.post");

  const apply = (r: Run) => {
    setRun(r);
    setDraft(
      Object.fromEntries(
        r.lines.map((x) => [
          x.id,
          { included: x.included, amount: String(Number(x.amount)), bankAccountId: x.bankAccountId },
        ]),
      ),
    );
  };
  const load = useCallback(
    () =>
      api<Run>(`/payment-runs/${id}`)
        .then(apply)
        .catch((e: Error) => toast.error(e.message)),
    [id],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (!run) return <p className="muted">{l("Memuat…", "Loading…")}</p>;

  const editable = run.state === "draft" && write;
  const dirty = run.lines.some((x) => {
    const d = draft[x.id];
    return (
      d &&
      (d.included !== x.included ||
        Number(d.amount) !== Number(x.amount) ||
        d.bankAccountId !== x.bankAccountId)
    );
  });
  const act = async (fn: () => Promise<Run>, success: string) => {
    setBusy(true);
    try {
      apply(await fn());
      toast.success(success);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    act(
      () =>
        api<Run>(`/payment-runs/${id}`, {
          method: "PUT",
          body: {
            lines: run.lines.map((x) => ({
              id: x.id,
              included: draft[x.id]!.included,
              amount: draft[x.id]!.amount,
              bankAccountId: draft[x.id]!.bankAccountId,
            })),
          },
        }),
      l("Perubahan disimpan", "Changes saved"),
    );
  const action = async (path: string, confirm: string | null, success: string, danger = false) => {
    if (confirm && !(await ask({ message: confirm, danger }))) return;
    await act(() => api<Run>(`/payment-runs/${id}/${path}`, { method: "POST" }), success);
  };
  const fail = async (g: Group) => {
    if (
      !(await ask({
        message: l(
          `Transfer ke ${g.partnerName} gagal? Pembayarannya dibalik dan tagihannya terbuka lagi.`,
          `Did the transfer to ${g.partnerName} fail? Its payment is reversed and the bills reopen.`,
        ),
        danger: true,
      }))
    )
      return;
    await act(
      () => api<Run>(`/payment-runs/${id}/fail`, { method: "POST", body: { partnerId: g.partnerId } }),
      l("Pembayaran dibalik", "Payment reversed"),
    );
  };
  const file = async (format: string) => {
    try {
      const info = await api<{
        filename: string;
        count: number;
        skipped: { name: string; reason: string }[];
      }>(`/payment-runs/${id}/bank-file?format=${format}&info=1`);
      if (!info.count) {
        toast.error(
          l("Tidak ada pemasok dengan rekening di bank ini", "No vendors with an account at this bank"),
        );
        return;
      }
      await download(`/payment-runs/${id}/bank-file?format=${format}`, info.filename);
      if (info.skipped.length)
        toast.info(
          l(
            `${info.count} pemasok di file; dilewati: ${info.skipped.map((s) => `${s.name} (${s.reason})`).join(", ")}`,
            `${info.count} vendors in file; skipped: ${info.skipped.map((s) => `${s.name} (${s.reason})`).join(", ")}`,
          ),
        );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const byPartner = run.lines.reduce<Record<string, Line[]>>(
    (acc, x) => ({ ...acc, [x.partnerId]: [...(acc[x.partnerId] ?? []), x] }),
    {},
  );
  const lineState = (x: Line) =>
    x.state === "paid" ? l("Dibayar", "Paid") : x.state === "failed" ? l("Gagal", "Failed") : "";

  return (
    <div className="stack-wide">
      <header className="toolbar">
        <h1>
          <Link href="/accounting/payment-runs">{l("Payment run", "Payment runs")}</Link> / {run.name}
        </h1>
        <span className={`pill ${run.state === "done" || run.state === "approved" ? "ok" : ""}`}>
          {l(...(RUN_STATE[run.state] ?? [run.state, run.state]))}
        </span>
      </header>
      <div className="panel">
        <p>
          {l("Tanggal bayar", "Payment date")}: <strong>{formatDate(run.paymentDate, locale)}</strong> ·{" "}
          {l("Jatuh tempo s.d.", "Due by")} {formatDate(run.dueUntil, locale)} · {run.journal?.code}{" "}
          {run.journal?.name}
          {run.journal?.bankAccountNumber ? ` (${run.journal.bankAccountNumber})` : ""} ·{" "}
          {l("Total", "Total")} <strong>{m(run.total)}</strong>
        </p>
        {run.approvalRequest && (
          <p className="muted">
            {l("Permintaan persetujuan", "Approval request")}:{" "}
            <Link href={`/hr/approval-requests/${run.approvalRequest.id}`}>
              {run.approvalRequest.number ?? "—"}
            </Link>
          </p>
        )}
        {run.warnings.map((w) => (
          <p key={w} className="error">
            {w}
          </p>
        ))}
        <div className="cp-right">
          {editable && dirty && (
            <button className="primary" disabled={busy} onClick={save}>
              {l("Simpan perubahan", "Save changes")}
            </button>
          )}
          {editable && !dirty && (
            <button
              className="primary"
              disabled={busy || !run.groups.length}
              onClick={() =>
                void action("submit", null, l("Diajukan untuk persetujuan", "Submitted for approval"))
              }
            >
              {l("Ajukan persetujuan", "Submit for approval")}
            </button>
          )}
          {run.state === "approved" && post && (
            <button
              className="primary"
              disabled={busy}
              aria-busy={busy}
              onClick={() =>
                void action(
                  "execute",
                  l(
                    `Eksekusi ${run.name}? Pembayaran diposting per pemasok dan tagihan dilunasi.`,
                    `Execute ${run.name}? Payments are posted per vendor and the bills are settled.`,
                  ),
                  l("Pembayaran diposting", "Payments posted"),
                )
              }
            >
              {l("Eksekusi & posting", "Execute & post")}
            </button>
          )}
          {(run.state === "approved" || run.state === "done") && (
            <span className="bank-files">
              {l("File bank", "Bank file")}:{" "}
              {BANK_FORMATS.map((f) => (
                <button key={f} type="button" onClick={() => void file(f)}>
                  {FORMAT_LABEL[f]}
                </button>
              ))}
            </span>
          )}
          {["draft", "in_approval", "approved"].includes(run.state) && write && (
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={() =>
                void action(
                  "cancel",
                  l(`Batalkan ${run.name}?`, `Cancel ${run.name}?`),
                  l("Payment run dibatalkan", "Payment run cancelled"),
                  true,
                )
              }
            >
              {l("Batalkan", "Cancel")}
            </button>
          )}
        </div>
      </div>
      <div className="table-wrap">
        <table className="lines">
          <thead>
            <tr>
              <th>{editable ? l("Bayar", "Pay") : ""}</th>
              <th>{l("Tagihan", "Bill")}</th>
              <th>{l("Jatuh tempo", "Due")}</th>
              <th className="num">{l("Sisa", "Open")}</th>
              <th className="num">{l("Dibayar", "Pay amount")}</th>
              <th>{l("Status", "Status")}</th>
            </tr>
          </thead>
          <tbody>
            {Object.values(byPartner).map((lines) => {
              const first = lines[0]!;
              const group = run.groups.find((g) => g.partnerId === first.partnerId);
              return (
                <Fragment key={first.partnerId}>
                  <tr className="section">
                    <th colSpan={4}>
                      {first.partnerName}{" "}
                      {editable ? (
                        <select
                          aria-label={l("Rekening tujuan", "Destination account")}
                          value={draft[first.id]?.bankAccountId ?? ""}
                          onChange={(e) =>
                            setDraft((d) => {
                              const next = { ...d };
                              for (const x of lines)
                                next[x.id] = { ...next[x.id]!, bankAccountId: e.target.value || null };
                              return next;
                            })
                          }
                        >
                          <option value="">{l("— tanpa rekening —", "— no account —")}</option>
                          {first.banks.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.bankName} {b.accountNumber}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="muted">
                          {group?.bankAccount
                            ? `${group.bankAccount.bankName} ${group.bankAccount.accountNumber} a.n. ${group.bankAccount.accountHolder}`
                            : l("tanpa rekening", "no account")}
                        </span>
                      )}
                    </th>
                    <th className="num">{group ? m(group.total) : "—"}</th>
                    <th>
                      {run.state === "done" && group?.state === "paid" && post && (
                        <button type="button" className="link danger" onClick={() => void fail(group)}>
                          {l("Transfer gagal", "Transfer failed")}
                        </button>
                      )}
                    </th>
                  </tr>
                  {lines.map((x) => (
                    <tr key={x.id} className={draft[x.id]?.included === false ? "muted" : undefined}>
                      <td>
                        {editable && (
                          <input
                            type="checkbox"
                            aria-label={l(`Bayar ${x.moveName}`, `Pay ${x.moveName}`)}
                            checked={draft[x.id]?.included ?? x.included}
                            onChange={(e) =>
                              setDraft((d) => ({ ...d, [x.id]: { ...d[x.id]!, included: e.target.checked } }))
                            }
                          />
                        )}
                      </td>
                      <td>
                        <Link href={`/accounting/moves/${x.moveId}`}>{x.moveName}</Link>
                        {x.ref && <span className="muted"> · {x.ref}</span>}
                      </td>
                      <td>{formatDate(x.dueDate ?? x.date, locale)}</td>
                      <td className="num">{m(x.residual)}</td>
                      <td className="num">
                        {editable ? (
                          <input
                            className="num"
                            inputMode="decimal"
                            aria-label={l("Jumlah dibayar", "Pay amount")}
                            value={draft[x.id]?.amount ?? ""}
                            onChange={(e) =>
                              setDraft((d) => ({ ...d, [x.id]: { ...d[x.id]!, amount: e.target.value } }))
                            }
                          />
                        ) : x.included ? (
                          m(x.amount)
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {lineState(x)}
                        {x.error && <small className="error"> {x.error}</small>}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
