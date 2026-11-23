"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  ApprovalRequestForm,
  REQUEST_BADGE,
  REQUEST_STATE_LABEL,
  type ApprovalCategory,
} from "../../../../components/hr/approval-request-form";
import { useMe } from "../../../../components/me-context";
import { api } from "../../../../lib/api";
import { formatDate, money, localDay } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";
import { SortTh, TablePager, TableTools, type ViewColumn } from "../../../../components/data-table";
import { useTableView } from "../../../../lib/use-table-view";

interface Row {
  id: string;
  number: string | null;
  subject: string;
  state: string;
  amount: string | null;
  createdAt: string;
  categoryName: string;
  requesterName: string | null;
}

type Tab = "mine" | "review" | "all";

/** Permintaan persetujuan: milik saya, perlu saya tinjau, semua (HR). */
export default function ApprovalRequestsPage() {
  return (
    <Suspense>
      <Requests />
    </Suspense>
  );
}

function Requests() {
  const { l, tx, locale } = useI18n();
  const me = useMe();
  const router = useRouter();
  const params = useSearchParams();
  const hr = can(me.permissions, "hr.read");
  const [tab, setTab] = useState<Tab>(
    (params.get("tab") as Tab) ?? (params.get("mine") || !hr ? "mine" : "all"),
  );
  const [rows, setRows] = useState<Row[] | null>(null);
  const [categories, setCategories] = useState<ApprovalCategory[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<ApprovalCategory[]>("/approval-categories?active=1").then(setCategories, () => setCategories([]));
  }, []);
  useEffect(() => {
    const q = new URLSearchParams();
    if (tab === "mine") q.set("mine", "1");
    if (tab === "review") q.set("review", "1");
    setRows(null);
    api<Row[]>(`/approval-requests?${q}`).then(setRows, (e: Error) => setError(e.message));
  }, [tab]);

  const columns = useMemo<ViewColumn<Row>[]>(
    () => [
      { key: "number", label: l("Nomor", "Number"), value: (r) => r.number },
      { key: "subject", label: l("Subjek", "Subject"), value: (r) => r.subject },
      { key: "category", label: l("Kategori", "Category"), type: "enum", value: (r) => r.categoryName },
      { key: "requester", label: l("Pemohon", "Requester"), type: "enum", value: (r) => r.requesterName },
      {
        key: "createdAt",
        label: l("Dibuat", "Created"),
        type: "date",
        value: (r) => localDay(r.createdAt),
      },
      {
        key: "amount",
        label: l("Nominal", "Amount"),
        type: "number",
        value: (r) => (r.amount === null ? null : Number(r.amount)),
      },
      {
        key: "state",
        label: l("Status", "Status"),
        type: "enum",
        value: (r) => r.state,
        optionLabel: (v) => (REQUEST_STATE_LABEL[v] ? tx(REQUEST_STATE_LABEL[v]!) : v),
        text: (r) => (REQUEST_STATE_LABEL[r.state] ? tx(REQUEST_STATE_LABEL[r.state]!) : r.state),
      },
    ],
    [l, tx],
  );
  const table = useTableView(rows ?? [], columns, {
    storageKey: "approval-requests",
    defaultSort: { key: "createdAt", dir: "desc" },
  });

  const tabs: [Tab, string][] = [
    ["mine", l("Milik saya", "Mine")],
    ["review", l("Perlu ditinjau", "To review")],
    ...(hr ? ([["all", l("Semua", "All")]] as [Tab, string][]) : []),
  ];

  return (
    <div className="panel">
      <header className="toolbar">
        <h1>{l("Permintaan Persetujuan", "Approval Requests")}</h1>
        {!open && categories.length > 0 && (
          <button type="button" className="primary" onClick={() => setOpen(true)}>
            {l("Permintaan baru", "New request")}
          </button>
        )}
        <Link href="/hr/approval-delegations">{l("Delegasi", "Delegations")}</Link>
        {can(me.permissions, "hr.manage") && (
          <Link href="/settings/approval-rules?tab=categories">{l("Kategori", "Categories")}</Link>
        )}
      </header>
      {open && (
        <ApprovalRequestForm
          categories={categories}
          onSaved={(r) => router.push(`/hr/approval-requests/${r.id}`)}
          onCancel={() => setOpen(false)}
        />
      )}
      <div className="toolbar">
        <div className="tabs" role="tablist">
          {tabs.map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              className={tab === k ? "active" : ""}
              onClick={() => setTab(k)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <TableTools
        view={table}
        placeholder={l("Cari nomor, subjek, pemohon…", "Search number, subject, requester…")}
      />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <SortTh view={table} col="number">
                {l("Nomor", "Number")}
              </SortTh>
              <SortTh view={table} col="subject">
                {l("Subjek", "Subject")}
              </SortTh>
              <SortTh view={table} col="category">
                {l("Kategori", "Category")}
              </SortTh>
              <SortTh view={table} col="requester">
                {l("Pemohon", "Requester")}
              </SortTh>
              <SortTh view={table} col="createdAt">
                {l("Dibuat", "Created")}
              </SortTh>
              <SortTh view={table} col="amount" className="num">
                {l("Nominal", "Amount")}
              </SortTh>
              <SortTh view={table} col="state">
                {l("Status", "Status")}
              </SortTh>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/hr/approval-requests/${r.id}`}>{r.number ?? l("(draft)", "(draft)")}</Link>
                </td>
                <td>{r.subject}</td>
                <td>{r.categoryName}</td>
                <td>{r.requesterName}</td>
                <td>{formatDate(r.createdAt, locale)}</td>
                <td className="num">{r.amount ? money(r.amount, locale) : ""}</td>
                <td>
                  <span className={`badge ${REQUEST_BADGE[r.state] ?? ""}`}>
                    {tx(REQUEST_STATE_LABEL[r.state]!)}
                  </span>
                </td>
              </tr>
            ))}
            {rows && table.rows.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  {rows.length
                    ? l("Tidak ada data yang cocok dengan filter.", "No rows match the filters.")
                    : l("Belum ada permintaan.", "No requests yet.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <TablePager view={table} />
    </div>
  );
}
