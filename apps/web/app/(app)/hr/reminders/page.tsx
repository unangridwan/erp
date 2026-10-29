"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DOCUMENT_KIND_LABEL, errorText } from "../../../../components/hr/hr-panels";
import { api } from "../../../../lib/api";
import { formatDate } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";

type Expiry = { days: number; status: "expired" | "soon" | "ok" } | null;
interface Reminders {
  documents: {
    id: string;
    kind: string;
    name: string;
    expiryDate: string;
    employeeId: string;
    employeeName: string;
    expiry: Expiry;
  }[];
  contracts: { id: string; name: string; dateEnd: string; employeeName: string; expiry: Expiry }[];
  overdueTasks: { id: string; name: string; dueDate: string; checklistId: string; employeeName: string }[];
}

/** Pengingat HR: kontrak PKWT berakhir, dokumen kedaluwarsa, tugas checklist lewat tenggat. */
export default function RemindersPage() {
  const { l, tx, locale } = useI18n();
  const [days, setDays] = useState("30");
  const [r, setR] = useState<Reminders | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Reminders>(`/hr/reminders?days=${days}`).then(setR, (e) => setError(errorText(e)));
  }, [days]);
  const left = (e: Expiry) =>
    !e
      ? ""
      : e.days < 0
        ? l(`lewat ${-e.days} hari`, `${-e.days} days ago`)
        : l(`${e.days} hari lagi`, `in ${e.days} days`);

  return (
    <div className="panel">
      <header className="toolbar">
        <h1>{l("Pengingat HR", "HR Reminders")}</h1>
        <select value={days} onChange={(e) => setDays(e.target.value)} aria-label={l("Rentang", "Range")}>
          {["7", "30", "60", "90"].map((d) => (
            <option key={d} value={d}>
              {l(`${d} hari ke depan`, `Next ${d} days`)}
            </option>
          ))}
        </select>
      </header>
      <p className="muted">
        {l(
          "Pengguna dengan hak hr.manage juga menerima ringkasan ini lewat email setiap hari.",
          "Users with hr.manage also receive this summary by email daily.",
        )}
      </p>
      {error && <p className="error">{error}</p>}
      {r && (
        <>
          <h2>{l("Kontrak PKWT berakhir", "Fixed-term contracts ending")}</h2>
          {r.contracts.length === 0 ? (
            <p className="muted">—</p>
          ) : (
            <div className="table-scroll">
              <table>
                <tbody>
                  {r.contracts.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/hr/contracts/${c.id}`}>{c.name}</Link>
                      </td>
                      <td>{c.employeeName}</td>
                      <td>{formatDate(c.dateEnd, locale)}</td>
                      <td className={c.expiry?.status === "expired" ? "error" : undefined}>
                        {left(c.expiry)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h2>{l("Dokumen kedaluwarsa", "Expiring documents")}</h2>
          {r.documents.length === 0 ? (
            <p className="muted">—</p>
          ) : (
            <div className="table-scroll">
              <table>
                <tbody>
                  {r.documents.map((d) => (
                    <tr key={d.id}>
                      <td>
                        {tx(DOCUMENT_KIND_LABEL[d.kind]!)}: {d.name}
                      </td>
                      <td>
                        <Link href={`/employees/${d.employeeId}`}>{d.employeeName}</Link>
                      </td>
                      <td>{formatDate(d.expiryDate, locale)}</td>
                      <td className={d.expiry?.status === "expired" ? "error" : undefined}>
                        {left(d.expiry)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h2>{l("Tugas checklist lewat tenggat", "Overdue checklist tasks")}</h2>
          {r.overdueTasks.length === 0 ? (
            <p className="muted">—</p>
          ) : (
            <div className="table-scroll">
              <table>
                <tbody>
                  {r.overdueTasks.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <Link href={`/hr/checklists/${t.checklistId}`}>{t.name}</Link>
                      </td>
                      <td>{t.employeeName}</td>
                      <td className="error">{formatDate(t.dueDate, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
