"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  ApprovalRequestForm,
  REQUEST_BADGE,
  REQUEST_STATE_LABEL,
  type ApprovalCategory,
} from "../../../../components/hr/approval-request-form";
import { useMe } from "../../../../components/me-context";
import { api } from "../../../../lib/api";
import { formatDate, money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

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
  const [state, setState] = useState("");
  const [categoryId, setCategoryId] = useState("");
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
    if (state) q.set("state", state);
    if (categoryId) q.set("categoryId", categoryId);
    setRows(null);
    api<Row[]>(`/approval-requests?${q}`).then(setRows, (e: Error) => setError(e.message));
  }, [tab, state, categoryId]);

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
          <Link href="/hr/approval-categories">{l("Kategori", "Categories")}</Link>
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
        <select value={state} onChange={(e) => setState(e.target.value)} aria-label={l("Status", "Status")}>
          <option value="">{l("Semua status", "All states")}</option>
          {Object.entries(REQUEST_STATE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {tx(v)}
            </option>
          ))}
        </select>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          aria-label={l("Kategori", "Category")}
        >
          <option value="">{l("Semua kategori", "All categories")}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{l("Nomor", "Number")}</th>
              <th>{l("Subjek", "Subject")}</th>
              <th>{l("Kategori", "Category")}</th>
              <th>{l("Pemohon", "Requester")}</th>
              <th>{l("Dibuat", "Created")}</th>
              <th className="num">{l("Nominal", "Amount")}</th>
              <th>{l("Status", "Status")}</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/hr/approval-requests/${r.id}`}>{r.number ?? l("(draft)", "(draft)")}</Link>
                </td>
                <td>{r.subject}</td>
                <td>{r.categoryName}</td>
                <td>{r.requesterName}</td>
                <td>{formatDate(r.createdAt.slice(0, 10), locale)}</td>
                <td className="num">{r.amount ? money(r.amount, locale) : ""}</td>
                <td>
                  <span className={`badge ${REQUEST_BADGE[r.state] ?? ""}`}>
                    {tx(REQUEST_STATE_LABEL[r.state]!)}
                  </span>
                </td>
              </tr>
            ))}
            {rows?.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  {l("Belum ada permintaan.", "No requests yet.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
