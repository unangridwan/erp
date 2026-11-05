"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useOptions, type AccountOption } from "../../../../../components/accounting/use-options";
import { useMe } from "../../../../../components/me-context";
import { api } from "../../../../../lib/api";
import { formatDate, money } from "../../../../../lib/format";
import { useI18n } from "../../../../../lib/i18n";
import { can } from "../../../../../lib/resources";
import { ask } from "../../../../../components/feedback";

interface StatementLine {
  id: string;
  date: string;
  paymentRef: string;
  partnerName: string | null;
  amount: string;
  moveId: string | null;
  moveName: string | null;
  matchedPartnerName: string | null;
}
interface Statement {
  id: string;
  name: string;
  date: string;
  balanceStart: string | null;
  balanceEnd: string | null;
  lines: StatementLine[];
}
interface Suggestion {
  id: string;
  moveId: string;
  moveName: string;
  partnerName: string | null;
  residual: string;
  date: string;
  score: number;
}

export default function StatementPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const { l, locale } = useI18n();
  const [statement, setStatement] = useState<Statement | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Statement>(`/bank-statements/${id}`)
      .then(setStatement)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  async function undo(lineId: string) {
    if (
      !(await ask(
        l(
          "Batalkan rekonsiliasi baris ini? Entri jurnalnya akan dibalik.",
          "Undo this reconciliation? Its journal entry will be reversed.",
        ),
      ))
    )
      return;
    try {
      setStatement(await api<Statement>(`/bank-statement-lines/${lineId}/undo`, { method: "POST" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!statement) return <p className="muted">{error ?? l("Memuat…", "Loading…")}</p>;
  const open = statement.lines.filter((x) => !x.moveId).length;
  const canPost = can(me.permissions, "accounting.post");

  return (
    <>
      <header className="toolbar">
        <h1>{statement.name}</h1>
        <span className="muted">
          {open === 0
            ? l("Semua baris sudah dicocokkan", "All lines reconciled")
            : `${open} ${l("baris belum dicocokkan", "lines to reconcile")}`}
        </span>
      </header>
      {error && <p className="error">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{l("Tanggal", "Date")}</th>
              <th>{l("Keterangan", "Description")}</th>
              <th>{l("Partner", "Partner")}</th>
              <th className="num">{l("Jumlah", "Amount")}</th>
              <th>{l("Status", "Status")}</th>
            </tr>
          </thead>
          <tbody>
            {statement.lines.map((line) => (
              <LineRow
                key={line.id}
                line={line}
                expanded={active === line.id}
                canPost={canPost}
                onToggle={() => setActive(active === line.id ? null : line.id)}
                onDone={(s) => {
                  setStatement(s);
                  setActive(null);
                }}
                onUndo={() => undo(line.id)}
                locale={locale}
              />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function LineRow(props: {
  line: StatementLine;
  expanded: boolean;
  canPost: boolean;
  onToggle: () => void;
  onDone: (s: Statement) => void;
  onUndo: () => void;
  locale: "id" | "en";
}) {
  const { line, expanded } = props;
  const { l } = useI18n();
  const accounts = useOptions<AccountOption>(expanded ? "/accounts" : null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [accountId, setAccountId] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded) return;
    api<Suggestion[]>(`/bank-statement-lines/${line.id}/suggestions`)
      .then((s) => {
        setSuggestions(s);
        // Pilih otomatis saran terbaik bila jumlahnya persis sama.
        const best = s[0];
        if (best && Math.abs(Number(best.residual)) === Math.abs(Number(line.amount))) setSelected([best.id]);
      })
      .catch(() => setSuggestions([]));
  }, [expanded, line.id, line.amount]);

  const allocated = suggestions
    .filter((s) => selected.includes(s.id))
    .reduce((t, s) => t + Math.abs(Number(s.residual)), 0);
  const remaining = Math.max(0, Math.abs(Number(line.amount)) - allocated);

  async function reconcile() {
    setError(null);
    try {
      props.onDone(
        await api<Statement>(`/bank-statement-lines/${line.id}/reconcile`, {
          method: "POST",
          body: { moveLineIds: selected, accountId: accountId || null, label: label || null },
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const amount = Number(line.amount);
  return (
    <>
      <tr>
        <td>{formatDate(line.date, props.locale)}</td>
        <td>{line.paymentRef}</td>
        <td>{line.matchedPartnerName ?? line.partnerName}</td>
        <td className={`num ${amount < 0 ? "error" : ""}`}>{money(line.amount, props.locale)}</td>
        <td>
          {line.moveId ? (
            <>
              <Link href={`/accounting/moves/${line.moveId}`}>{line.moveName}</Link>{" "}
              {props.canPost && (
                <button className="link" onClick={props.onUndo}>
                  {l("Batalkan", "Undo")}
                </button>
              )}
            </>
          ) : props.canPost ? (
            <button onClick={props.onToggle}>
              {expanded ? l("Tutup", "Close") : l("Cocokkan", "Match")}
            </button>
          ) : (
            <span className="muted">{l("Belum dicocokkan", "Not reconciled")}</span>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="detail">
          <td colSpan={5}>
            <div className="stack">
              <strong>
                {amount > 0
                  ? l("Lunasi faktur pelanggan", "Settle customer invoices")
                  : l("Lunasi tagihan pemasok", "Settle vendor bills")}
              </strong>
              {suggestions.length === 0 && (
                <span className="muted">
                  {l("Tidak ada dokumen terbuka yang cocok.", "No matching open documents.")}
                </span>
              )}
              {suggestions.map((s) => (
                <label key={s.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(s.id)}
                    onChange={(e) =>
                      setSelected((x) => (e.target.checked ? [...x, s.id] : x.filter((v) => v !== s.id)))
                    }
                  />{" "}
                  {s.moveName} · {s.partnerName} · {formatDate(s.date, props.locale)} · {l("sisa", "due")}{" "}
                  {money(Math.abs(Number(s.residual)), props.locale)}
                </label>
              ))}
              {remaining > 0 && (
                <div className="fields">
                  <label className="field">
                    <span>
                      {l("Akun untuk sisa", "Account for remainder")} ({money(remaining, props.locale)})
                    </span>
                    <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                      <option value="">—</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>{l("Keterangan", "Label")}</span>
                    <input value={label} onChange={(e) => setLabel(e.target.value)} />
                  </label>
                </div>
              )}
              <button className="primary" onClick={reconcile} disabled={remaining > 0 && !accountId}>
                {l("Rekonsiliasi", "Reconcile")}
              </button>
              {error && <p className="error">{error}</p>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
