"use client";

import { ACCOUNT_RATING_LABEL, LEAD_STATUS_LABEL, TICKET_STATUS_LABEL } from "@erp/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { formatDate, money } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { ACTIVITY_TYPES, can, LEAD_STATE_LABEL, ORDER_STATE_LABEL } from "../../lib/resources";
import { useMe } from "../me-context";
import { ActivitiesPanel } from "./activities-panel";

interface View {
  partner: {
    id: string;
    name: string;
    kind: "company" | "person";
    email: string | null;
    phone: string | null;
    street: string | null;
    city: string | null;
    province: string | null;
    industry: string | null;
    website: string | null;
    employeeCount: number | null;
    annualRevenue: string | null;
    jobTitle: string | null;
    accountRating: string | null;
    doNotContact: boolean;
    salespersonName: string | null;
  };
  parent: { id: string; name: string } | null;
  contacts: {
    id: string;
    name: string;
    jobTitle: string | null;
    email: string | null;
    phone: string | null;
    doNotContact: boolean;
  }[];
  summary: {
    openCount: number;
    pipeline: string;
    weighted: string;
    wonCount: number;
    wonAmount: string;
    lostCount: number;
    winRate: number | null;
    openLeads: number;
  };
  leads: {
    id: string;
    name: string;
    leadType: string;
    leadStatus: string;
    state: string;
    stageName: string | null;
    userName: string | null;
    expectedRevenue: string;
    expectedClose: string | null;
    nextStep: string | null;
  }[];
  activities: {
    id: string;
    activityType: string;
    summary: string;
    dueDate: string;
    doneAt: string | null;
    userName: string | null;
  }[];
  sales: {
    orders: {
      id: string;
      name: string;
      state: string;
      dateOrder: string;
      amountTotal: string;
      currencyCode: string;
    }[];
    quotations: number;
    confirmed: number;
    confirmedAmount: string;
  } | null;
  support: {
    open: number;
    total: number;
    avgSatisfaction: number | null;
    tickets: {
      id: string;
      number: string;
      subject: string;
      status: string;
      priority: string;
      createdAt: string;
      satisfaction: number | null;
    }[];
  } | null;
  invoicing: {
    invoices: {
      id: string;
      name: string | null;
      moveType: string;
      date: string;
      dueDate: string | null;
      amountTotal: string;
      amountResidual: string;
    }[];
    invoiced: string;
    outstanding: string;
    overdue: string;
  } | null;
}

/** Tampilan 360° akun/kontak: profil, kontak, peluang, penawaran & pesanan, faktur, aktivitas. */
export function Account360({ id }: { id: string }) {
  const me = useMe();
  const { l, tx, locale } = useI18n();
  const [data, setData] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    api<View>(`/crm/accounts/${id}`)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [id, version]);

  if (!data) return <p className={error ? "error" : "muted"}>{error ?? l("Memuat…", "Loading…")}</p>;
  const { partner: p, summary: s } = data;
  const company = p.kind === "company";
  const info: [string, React.ReactNode][] = [
    [l("Email", "Email"), p.email],
    [l("Telepon", "Phone"), p.phone],
    [l("Alamat", "Address"), [p.street, p.city, p.province].filter(Boolean).join(", ")],
    ...(company
      ? ([
          [l("Industri", "Industry"), p.industry],
          [l("Situs web", "Website"), p.website],
          [l("Karyawan", "Employees"), p.employeeCount?.toLocaleString(locale)],
          [l("Omzet tahunan", "Annual revenue"), p.annualRevenue ? money(p.annualRevenue, locale) : null],
        ] as [string, React.ReactNode][])
      : ([[l("Jabatan", "Job title"), p.jobTitle]] as [string, React.ReactNode][])),
    [l("Penanggung jawab", "Owner"), p.salespersonName],
  ];
  const activityLabel = (t: string) => {
    const found = ACTIVITY_TYPES.find(([v]) => v === t);
    return found ? tx(found[1]) : t;
  };

  return (
    <>
      <header className="toolbar">
        <h1>{p.name}</h1>
        <span className="badge">{company ? l("Akun", "Account") : l("Kontak", "Contact")}</span>
        {p.accountRating && ACCOUNT_RATING_LABEL[p.accountRating] && (
          <span className="badge">{l(...ACCOUNT_RATING_LABEL[p.accountRating]!)}</span>
        )}
        {p.doNotContact && (
          <span className="badge state-cancel">{l("Jangan dihubungi", "Do not contact")}</span>
        )}
        {data.parent && (
          <Link className="button" href={`/crm/accounts/${data.parent.id}`}>
            {l("Akun", "Account")}: {data.parent.name}
          </Link>
        )}
        {can(me.permissions, "partner.read") && (
          <Link className="button" href={`/partners/${p.id}`}>
            {l("Ubah data", "Edit record")}
          </Link>
        )}
        {can(me.permissions, "crm.write") && (
          <Link className="button primary" href={`/crm/leads/new?type=opportunity&partnerId=${p.id}`}>
            {l("Peluang baru", "New opportunity")}
          </Link>
        )}
      </header>

      <ul className="grid">
        <li className="card">
          <span>{l("Peluang terbuka", "Open opportunities")}</span>
          <strong>
            {s.openCount} · {money(s.pipeline, locale)}
          </strong>
        </li>
        <li className="card">
          <span>{l("Nilai tertimbang", "Weighted value")}</span>
          <strong>{money(s.weighted, locale)}</strong>
        </li>
        <li className="card">
          <span>{l("Menang", "Won")}</span>
          <strong>
            {s.wonCount} · {money(s.wonAmount, locale)}
          </strong>
        </li>
        <li className="card">
          <span>{l("Rasio menang", "Win rate")}</span>
          <strong>{s.winRate === null ? "—" : `${s.winRate}%`}</strong>
        </li>
        {data.invoicing && (
          <li className="card">
            <span>{l("Piutang belum lunas", "Outstanding receivables")}</span>
            <strong>{money(data.invoicing.outstanding, locale)}</strong>
            {Number(data.invoicing.overdue) > 0 && (
              <small className="error">
                {l("Lewat jatuh tempo", "Overdue")}: {money(data.invoicing.overdue, locale)}
              </small>
            )}
          </li>
        )}
      </ul>

      <div className="grid-2">
        <section className="panel">
          <h2>{l("Profil", "Profile")}</h2>
          <table>
            <tbody>
              {info
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <tr key={k}>
                    <th>{k}</th>
                    <td>{v}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
        {company && (
          <section className="panel">
            <h2>
              {l("Kontak", "Contacts")} ({data.contacts.length})
            </h2>
            {data.contacts.length === 0 ? (
              <p className="muted">
                {l(
                  "Belum ada kontak. Tambahkan kontak dengan memilih akun ini sebagai akun induk.",
                  "No contacts yet. Add a contact with this account as its parent.",
                )}
              </p>
            ) : (
              <div className="table-scroll">
                <table>
                  <tbody>
                    {data.contacts.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <Link href={`/crm/accounts/${c.id}`}>{c.name}</Link>
                        </td>
                        <td>{c.jobTitle}</td>
                        <td>{c.email}</td>
                        <td>{c.phone}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>

      <section className="panel">
        <h2>
          {l("Lead & peluang", "Leads & opportunities")} ({data.leads.length})
        </h2>
        {data.leads.length === 0 ? (
          <p className="muted">—</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{l("Nama", "Name")}</th>
                  <th>{l("Tahap / status", "Stage / status")}</th>
                  <th>{l("Penanggung jawab", "Salesperson")}</th>
                  <th>{l("Langkah berikut", "Next step")}</th>
                  <th>{l("Perkiraan closing", "Expected closing")}</th>
                  <th className="num">{l("Nilai", "Value")}</th>
                  <th>{l("Status", "Status")}</th>
                </tr>
              </thead>
              <tbody>
                {data.leads.map((x) => (
                  <tr key={x.id}>
                    <td>
                      <Link href={`/crm/leads/${x.id}`}>{x.name}</Link>
                    </td>
                    <td>
                      {x.leadType === "lead"
                        ? `${l("Lead", "Lead")} · ${LEAD_STATUS_LABEL[x.leadStatus] ? l(...LEAD_STATUS_LABEL[x.leadStatus]!) : x.leadStatus}`
                        : (x.stageName ?? "—")}
                    </td>
                    <td>{x.userName}</td>
                    <td>{x.nextStep}</td>
                    <td>{x.expectedClose ? formatDate(x.expectedClose, locale) : ""}</td>
                    <td className="num">{money(x.expectedRevenue, locale)}</td>
                    <td>
                      <span className={`badge state-${x.state}`}>{tx(LEAD_STATE_LABEL[x.state]!)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {data.sales && (
        <section className="panel">
          <h2>
            {l("Penawaran & pesanan", "Quotations & orders")} ({data.sales.orders.length})
          </h2>
          {data.sales.orders.length === 0 ? (
            <p className="muted">—</p>
          ) : (
            <div className="table-scroll">
              <table>
                <tbody>
                  {data.sales.orders.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <Link href={`/sales/orders/${o.id}`}>{o.name}</Link>
                      </td>
                      <td>{formatDate(o.dateOrder, locale)}</td>
                      <td>
                        <span className={`badge state-${o.state}`}>{tx(ORDER_STATE_LABEL[o.state]!)}</span>
                      </td>
                      <td className="num">
                        {o.currencyCode} {money(o.amountTotal, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {data.invoicing && (
        <section className="panel">
          <h2>
            {l("Faktur", "Invoices")} ({data.invoicing.invoices.length})
          </h2>
          {data.invoicing.invoices.length === 0 ? (
            <p className="muted">—</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{l("Nomor", "Number")}</th>
                    <th>{l("Tanggal", "Date")}</th>
                    <th>{l("Jatuh tempo", "Due date")}</th>
                    <th className="num">{l("Total", "Total")}</th>
                    <th className="num">{l("Sisa", "Balance")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.invoicing.invoices.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <Link href={`/accounting/moves/${i.id}`}>{i.name ?? "—"}</Link>
                        {i.moveType === "out_refund" && (
                          <span className="badge">{l("Nota kredit", "Credit note")}</span>
                        )}
                      </td>
                      <td>{formatDate(i.date, locale)}</td>
                      <td>{i.dueDate ? formatDate(i.dueDate, locale) : ""}</td>
                      <td className="num">{money(i.amountTotal, locale)}</td>
                      <td className="num">{money(i.amountResidual, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {data.support && (
        <section className="panel">
          <h2>
            {l("Tiket layanan", "Support tickets")} ({data.support.total}
            {data.support.open ? ` · ${data.support.open} ${l("terbuka", "open")}` : ""})
          </h2>
          {data.support.avgSatisfaction !== null && (
            <p className="muted">
              {l("Kepuasan rata-rata", "Average satisfaction")}: {data.support.avgSatisfaction} / 5
            </p>
          )}
          {data.support.tickets.length === 0 ? (
            <p className="muted">—</p>
          ) : (
            <div className="table-scroll">
              <table>
                <tbody>
                  {data.support.tickets.map((x) => (
                    <tr key={x.id}>
                      <td>
                        <Link href={`/support/tickets/${x.id}`}>{x.number}</Link>
                      </td>
                      <td>{x.subject}</td>
                      <td>
                        <span className="badge">{l(...TICKET_STATUS_LABEL[x.status]!)}</span>
                      </td>
                      <td>{formatDate(x.createdAt.slice(0, 10), locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {data.activities.some((a) => a.doneAt) && (
        <section className="panel">
          <h2>{l("Aktivitas selesai terakhir", "Recent completed activities")}</h2>
          <ul className="plain-list">
            {data.activities
              .filter((a) => a.doneAt)
              .slice(0, 10)
              .map((a) => (
                <li key={a.id}>
                  {formatDate(a.doneAt!.slice(0, 10), locale)} · {activityLabel(a.activityType)} · {a.summary}
                  {a.userName ? ` (${a.userName})` : ""}
                </li>
              ))}
          </ul>
        </section>
      )}
      <ActivitiesPanel
        resModel="partner"
        resId={p.id}
        editable={can(me.permissions, "partner.write")}
        onChange={() => setVersion((v) => v + 1)}
      />
    </>
  );
}
