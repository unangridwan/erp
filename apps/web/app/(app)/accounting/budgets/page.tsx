"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useMe } from "../../../../components/me-context";
import { api } from "../../../../lib/api";
import { formatDate } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

interface Budget {
  id: string;
  name: string;
  dateFrom: string;
  dateTo: string;
}

export default function BudgetsPage() {
  const me = useMe();
  const { l, locale } = useI18n();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Budget[]>("/budgets")
      .then(setBudgets)
      .catch((e: Error) => setError(e.message));
  }, []);
  return (
    <>
      <header className="toolbar">
        <h1>{l("Anggaran", "Budgets")}</h1>
        {can(me.permissions, "accounting.write") && (
          <Link className="button primary" href="/accounting/budgets/new">
            {l("Baru", "New")}
          </Link>
        )}
      </header>
      {error && <p className="error">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{l("Nama", "Name")}</th>
              <th>{l("Periode", "Period")}</th>
            </tr>
          </thead>
          <tbody>
            {budgets.map((b) => (
              <tr key={b.id}>
                <td>
                  <Link href={`/accounting/budgets/${b.id}`}>{b.name}</Link>
                </td>
                <td>
                  {formatDate(b.dateFrom, locale)} – {formatDate(b.dateTo, locale)}
                </td>
              </tr>
            ))}
            {budgets.length === 0 && (
              <tr>
                <td colSpan={2} className="muted">
                  {l("Belum ada anggaran.", "No budgets yet.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
