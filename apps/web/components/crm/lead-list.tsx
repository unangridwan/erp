"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { formatDate, money } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { can, LEAD_SOURCES, LEAD_STATE_LABEL } from "../../lib/resources";
import { useMe } from "../me-context";
import { Stars, type LeadRow } from "./pipeline";

const PAGE = 50;

/** Daftar lead & peluang (tabel) dengan filter jenis dan status. */
export function LeadList() {
  const me = useMe();
  const { l, tx, locale } = useI18n();
  const [q, setQ] = useState("");
  const [leadType, setLeadType] = useState("lead");
  const [state, setState] = useState("open");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ items: LeadRow[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (q) params.set("q", q);
    if (leadType) params.set("leadType", leadType);
    if (state) params.set("state", state);
    const timer = setTimeout(
      () =>
        api<{ items: LeadRow[]; total: number }>(`/leads?${params}`)
          .then(setData)
          .catch((e: Error) => setError(e.message)),
      200,
    );
    return () => clearTimeout(timer);
  }, [q, leadType, state, offset]);

  const source = (s: string | null) => {
    const found = LEAD_SOURCES.find(([v]) => v === s);
    return found ? tx(found[1]) : "";
  };

  return (
    <>
      <header className="toolbar">
        <h1>{l("Lead & Peluang", "Leads & Opportunities")}</h1>
        <input
          type="search"
          placeholder={l("Cari…", "Search…")}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
        />
        <select
          value={leadType}
          onChange={(e) => {
            setLeadType(e.target.value);
            setOffset(0);
          }}
        >
          <option value="lead">{l("Lead", "Leads")}</option>
          <option value="opportunity">{l("Peluang", "Opportunities")}</option>
          <option value="">{l("Semua", "All")}</option>
        </select>
        <select
          value={state}
          onChange={(e) => {
            setState(e.target.value);
            setOffset(0);
          }}
        >
          <option value="open">{l("Terbuka", "Open")}</option>
          <option value="won">{l("Menang", "Won")}</option>
          <option value="lost">{l("Kalah", "Lost")}</option>
          <option value="">{l("Semua status", "All states")}</option>
        </select>
        {can(me.permissions, "crm.write") && (
          <Link className="button primary" href={`/crm/leads/new?type=${leadType || "lead"}`}>
            {l("Baru", "New")}
          </Link>
        )}
      </header>
      {error && <p className="error">{error}</p>}
      {data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l("Nama", "Name")}</th>
                <th>{l("Pelanggan / kontak", "Customer / contact")}</th>
                <th>{l("Email", "Email")}</th>
                <th>{l("Sumber", "Source")}</th>
                <th>{l("Tahap", "Stage")}</th>
                <th>{l("Penanggung jawab", "Salesperson")}</th>
                <th className="num">{l("Pendapatan harapan", "Expected revenue")}</th>
                <th>{l("Dibuat", "Created")}</th>
                <th>{l("Status", "Status")}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((x) => (
                <tr key={x.id}>
                  <td>
                    <Link href={`/crm/leads/${x.id}`}>{x.name}</Link> <Stars n={x.priority} />
                  </td>
                  <td>{[x.partnerDisplay, x.contactName].filter(Boolean).join(" · ")}</td>
                  <td>{x.email}</td>
                  <td>{source(x.source)}</td>
                  <td>{x.stageName}</td>
                  <td>{x.userName}</td>
                  <td className="num">{money(x.expectedRevenue, locale)}</td>
                  <td>{formatDate(x.createdAt.slice(0, 10), locale)}</td>
                  <td>
                    <span className={`badge state-${x.state}`}>{tx(LEAD_STATE_LABEL[x.state]!)}</span>
                  </td>
                </tr>
              ))}
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={9} className="muted">
                    {l("Belum ada data.", "No records yet.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total > PAGE && (
        <div className="pager">
          <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            ‹
          </button>
          <span>
            {offset + 1}–{Math.min(offset + PAGE, data.total)} {l("dari", "of")} {data.total}
          </span>
          <button disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>
            ›
          </button>
        </div>
      )}
    </>
  );
}
