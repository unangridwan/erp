"use client";

import { businessToday, type FlowStatus, type KpiResult } from "@erp/shared";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "../../../../components/feedback";
import { LoadFailed, useLoadError } from "../../../../components/load-failed";
import { useMe } from "../../../../components/me-context";
import { api } from "../../../../lib/api";
import { formatDate, money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

interface Doc {
  id: string;
  model: string;
  name: string;
  partner: string | null;
  processLabel: [string, string];
  stageLabel: [string, string];
  waiting: [string, string];
  since: string;
  ageDays: number;
  slaDays: number | null;
  due: string | null;
  status: FlowStatus;
  value: number | null;
  owner: string | null;
  href: string | null;
  toDepartment: string | null;
  fromDepartment: string | null;
}

interface Work {
  today: string;
  department: { id: string; name: string } | null;
  summary: {
    documents: number;
    documentsLate: number;
    departmentWaiting: number;
    departmentLate: number;
    activitiesOverdue: number;
    activitiesToday: number;
    activities: number;
    tickets: number;
    ticketsLate: number;
    mentionsUnread: number;
  };
  documents: Doc[];
  departmentQueue: Doc[];
  activities: {
    id: string;
    summary: string;
    activityType: string;
    dueDate: string;
    document: string | null;
    modelLabel: [string, string] | null;
    href: string | null;
    overdue: boolean;
    today: boolean;
  }[];
  tickets: {
    id: string;
    number: string;
    subject: string;
    priority: string;
    status: string;
    resolveDue: string | null;
    late: boolean;
  }[];
  mentions: {
    id: string;
    kind: string;
    title: string;
    body: string | null;
    link: string | null;
    readAt: string | null;
    createdAt: string;
  }[];
}

interface History {
  days: number;
  total: number;
  byAction: Record<string, number>;
  byModel: { model: string; label: [string, string]; count: number }[];
  items: {
    id: string;
    model: string;
    modelLabel: [string, string];
    name: string | null;
    href: string | null;
    action: string;
    message: string | null;
    fields: number;
    createdAt: string;
  }[];
}

interface Approval {
  key: string;
  /** Ringkasan persetujuan SDM, atau nomor PO. */
  label: string;
  po: boolean;
  detail: string;
  href: string;
}

type Preset = "this_month" | "last_month" | "this_quarter" | "this_year";
type Tab = "docs" | "dept" | "activities" | "tickets" | "mentions" | "approvals";

function presetRange(preset: Preset): { from: string; to: string } {
  const today = businessToday();
  const y = Number(today.slice(0, 4));
  const mo = Number(today.slice(5, 7));
  const iso = (yy: number, mm: number, dd: number) =>
    new Date(Date.UTC(yy, mm - 1, dd)).toISOString().slice(0, 10);
  if (preset === "last_month") return { from: iso(y, mo - 1, 1), to: iso(y, mo, 0) };
  if (preset === "this_quarter") {
    const q = Math.floor((mo - 1) / 3) * 3 + 1;
    return { from: iso(y, q, 1), to: iso(y, q + 3, 0) };
  }
  if (preset === "this_year") return { from: `${y}-01-01`, to: `${y}-12-31` };
  return { from: iso(y, mo, 1), to: iso(y, mo + 1, 0) };
}

const ACTION: Record<string, [string, string]> = {
  create: ["Membuat", "Created"],
  update: ["Mengubah", "Updated"],
  delete: ["Menghapus", "Deleted"],
  comment: ["Mencatat", "Noted"],
  message: ["Berdiskusi", "Discussed"],
};

/**
 * Pekerjaan Saya: apa yang harus saya kerjakan (dokumen yang saya pegang, antrean departemen saya, aktivitas, tiket,
 * sebutan, persetujuan), bagaimana kinerja saya (KPI otomatis vs periode lalu & rekan), dan jejak kerja saya.
 */
export default function MyWorkPage() {
  const me = useMe();
  const { l, locale } = useI18n();
  const [preset, setPreset] = useState<Preset>("this_month");
  const range = useMemo(() => presetRange(preset), [preset]);
  const [work, setWork] = useState<Work | null>(null);
  const [kpis, setKpis] = useState<KpiResult[] | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [tab, setTab] = useState<Tab | null>(null);
  const [detail, setDetail] = useState<KpiResult | null>(null);
  const [error, fail] = useLoadError();

  useEffect(() => {
    api<Work>("/me/work").then(setWork).catch(fail);
    api<History>("/me/history").then(setHistory, () => setHistory(null));
    const list: Approval[] = [];
    Promise.allSettled([
      api<{ model: string; id: string; employeeName: string; summary: string }[]>("/approvals/pending").then(
        (rows) =>
          rows.forEach((p) =>
            list.push({
              key: `${p.model}:${p.id}`,
              label: p.summary,
              po: false,
              detail: p.employeeName,
              href: "/hr/approvals",
            }),
          ),
      ),
      can(me.permissions, "purchase.read")
        ? api<{ id: string; name: string; partnerName: string | null }[]>(
            "/purchase-orders/pending-approval",
          ).then((rows) =>
            rows.forEach((o) =>
              list.push({
                key: `po:${o.id}`,
                label: o.name,
                po: true,
                detail: o.partnerName ?? "",
                href: `/purchase/orders/${o.id}`,
              }),
            ),
          )
        : Promise.resolve(),
    ]).then(() => setApprovals([...list]));
  }, [fail, me.permissions]);
  useEffect(() => {
    setKpis(null);
    api<{ items: KpiResult[] }>(`/me/kpis?from=${range.from}&to=${range.to}`).then(
      (r) => setKpis(r.items),
      () => setKpis([]),
    );
  }, [range.from, range.to]);

  // Tab awal: yang paling mendesak.
  const s = work?.summary;
  const active: Tab =
    tab ??
    (s
      ? s.documentsLate
        ? "docs"
        : s.activitiesOverdue || s.activitiesToday
          ? "activities"
          : approvals.length
            ? "approvals"
            : s.departmentLate
              ? "dept"
              : s.mentionsUnread
                ? "mentions"
                : "docs"
      : "docs");

  if (error) return <LoadFailed message={error} />;
  const n = (v: number) => v.toLocaleString(locale === "id" ? "id-ID" : "en-US");
  const fmt = (k: Pick<KpiResult, "unit">, v: number | null) =>
    v === null
      ? "—"
      : k.unit === "money"
        ? money(v, locale, 0)
        : k.unit === "percent"
          ? `${v.toLocaleString(locale === "id" ? "id-ID" : "en-US", { maximumFractionDigits: 1 })}%`
          : k.unit === "days"
            ? l(`${n(v)} hari`, `${n(v)} days`)
            : n(v);

  const tabs: { key: Tab; label: string; count: number; alert: number }[] = [
    {
      key: "docs",
      label: l("Dokumen saya", "My documents"),
      count: s?.documents ?? 0,
      alert: s?.documentsLate ?? 0,
    },
    {
      key: "dept",
      label: work?.department
        ? l(`Menunggu di ${work.department.name}`, `Waiting in ${work.department.name}`)
        : l("Departemen saya", "My department"),
      count: s?.departmentWaiting ?? 0,
      alert: s?.departmentLate ?? 0,
    },
    {
      key: "activities",
      label: l("Aktivitas", "Activities"),
      count: s?.activities ?? 0,
      alert: s?.activitiesOverdue ?? 0,
    },
    { key: "approvals", label: l("Persetujuan", "Approvals"), count: approvals.length, alert: 0 },
    ...(can(me.permissions, "support.read")
      ? [
          {
            key: "tickets" as Tab,
            label: l("Tiket", "Tickets"),
            count: s?.tickets ?? 0,
            alert: s?.ticketsLate ?? 0,
          },
        ]
      : []),
    { key: "mentions", label: l("Sebutan", "Mentions"), count: s?.mentionsUnread ?? 0, alert: 0 },
  ];

  return (
    <>
      <header className="toolbar control-panel">
        <div className="cp-left">
          <h1>{l("Pekerjaan Saya", "My Work")}</h1>
        </div>
      </header>
      <p className="muted">
        {l(
          "Apa yang perlu Anda kerjakan sekarang, bagaimana kinerja Anda dibanding periode lalu & rekan, dan jejak kerja Anda — semuanya dihitung otomatis dari dokumen yang Anda pegang.",
          "What you need to do now, how you perform against last period & peers, and your work trail — all derived automatically from the documents you own.",
        )}
      </p>

      {!work ? (
        <p className="muted">{l("Memuat…", "Loading…")}</p>
      ) : (
        <>
          <section className="work-summary" aria-label={l("Ringkasan", "Summary")}>
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`work-stat${active === t.key ? " selected" : ""}${t.alert ? " alert" : ""}`}
                aria-pressed={active === t.key}
                onClick={() => setTab(t.key)}
              >
                <span className="muted small">{t.label}</span>
                <strong>{n(t.count)}</strong>
                {t.alert > 0 && (
                  <span className="badge danger">
                    {n(t.alert)}{" "}
                    {t.key === "activities" ? l("lewat jatuh tempo", "overdue") : l("terlambat", "late")}
                  </span>
                )}
              </button>
            ))}
          </section>

          <section className="panel work-panel">
            {(active === "docs" || active === "dept") && (
              <DocTable
                docs={active === "docs" ? work.documents : work.departmentQueue}
                total={active === "docs" ? work.summary.documents : work.summary.departmentWaiting}
                showOwner={active === "dept"}
                empty={
                  active === "docs"
                    ? l(
                        "Tidak ada dokumen alur bisnis yang sedang Anda pegang.",
                        "You are not holding any business-flow documents.",
                      )
                    : work.department
                      ? l(
                          "Tidak ada pekerjaan yang menunggu di departemen Anda.",
                          "Nothing is waiting in your department.",
                        )
                      : l(
                          "Akun Anda belum terhubung ke data karyawan dengan departemen.",
                          "Your account is not linked to an employee with a department.",
                        )
                }
                more={active === "dept" ? "/flow/handoffs" : null}
              />
            )}
            {active === "activities" &&
              (work.activities.length ? (
                <ul className="work-list">
                  {work.activities.map((a) => (
                    <li key={a.id} className={a.overdue ? "late" : undefined}>
                      <div>
                        <strong>{a.summary}</strong>
                        <div className="muted small">
                          {a.modelLabel && `${l(...a.modelLabel)} · `}
                          {a.href ? (
                            <Link href={a.href}>{a.document ?? l("Buka", "Open")}</Link>
                          ) : (
                            (a.document ?? "")
                          )}
                        </div>
                      </div>
                      <span className={`badge ${a.overdue ? "danger" : a.today ? "warn" : ""}`}>
                        {a.overdue
                          ? l(
                              `Lewat · ${formatDate(a.dueDate, locale)}`,
                              `Overdue · ${formatDate(a.dueDate, locale)}`,
                            )
                          : a.today
                            ? l("Hari ini", "Today")
                            : formatDate(a.dueDate, locale)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">{l("Tidak ada aktivitas terjadwal.", "No scheduled activities.")}</p>
              ))}
            {active === "approvals" &&
              (approvals.length ? (
                <ul className="work-list">
                  {approvals.map((a) => (
                    <li key={a.key}>
                      <Link href={a.href}>
                        {a.po ? l(`Setujui PO ${a.label}`, `Approve PO ${a.label}`) : a.label}
                      </Link>
                      <span className="muted small">{a.detail}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">
                  {l("Tidak ada persetujuan yang menunggu Anda.", "No approvals are waiting for you.")}
                </p>
              ))}
            {active === "tickets" &&
              (work.tickets.length ? (
                <ul className="work-list">
                  {work.tickets.map((t) => (
                    <li key={t.id} className={t.late ? "late" : undefined}>
                      <div>
                        <Link href={`/support/tickets/${t.id}`}>
                          {t.number} · {t.subject}
                        </Link>
                        <div className="muted small">
                          {t.priority} · {t.status}
                        </div>
                      </div>
                      {t.resolveDue && (
                        <span className={`badge ${t.late ? "danger" : ""}`}>
                          {l("Batas", "Due")} {formatDate(t.resolveDue.slice(0, 10), locale)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">
                  {l("Tidak ada tiket terbuka untuk Anda.", "No open tickets assigned to you.")}
                </p>
              ))}
            {active === "mentions" &&
              (work.mentions.length ? (
                <ul className="work-list">
                  {work.mentions.map((m) => (
                    <li key={m.id} className={m.readAt ? undefined : "unread"}>
                      <div>
                        {m.link ? <Link href={m.link}>{m.title}</Link> : <strong>{m.title}</strong>}
                        {m.body && <div className="muted small">{m.body}</div>}
                      </div>
                      <span className="muted small">{formatDate(m.createdAt.slice(0, 10), locale)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">
                  {l(
                    "Belum ada sebutan atau pengingat 30 hari terakhir.",
                    "No mentions or reminders in the last 30 days.",
                  )}
                </p>
              ))}
          </section>
        </>
      )}

      <section className="work-section">
        <div className="panel-head">
          <h2>{l("KPI saya", "My KPIs")}</h2>
          <div className="tabs" role="tablist" aria-label={l("Periode", "Period")}>
            {(
              [
                ["this_month", l("Bulan ini", "This month")],
                ["last_month", l("Bulan lalu", "Last month")],
                ["this_quarter", l("Kuartal ini", "This quarter")],
                ["this_year", l("Tahun ini", "This year")],
              ] as [Preset, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={preset === k}
                className={preset === k ? "active" : ""}
                onClick={() => setPreset(k)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {!kpis ? (
          <p className="muted">{l("Memuat…", "Loading…")}</p>
        ) : !kpis.length ? (
          <p className="muted">
            {l(
              "Belum ada KPI otomatis untuk pekerjaan Anda. KPI muncul ketika Anda memegang dokumen (pesanan, peluang, PO, faktur, order produksi, perawatan) dalam 6 bulan terakhir.",
              "No automatic KPIs for your work yet. KPIs appear once you own documents (orders, opportunities, POs, invoices, production orders, maintenance) in the last 6 months.",
            )}
          </p>
        ) : (
          <div className="kpi-grid">
            {kpis.map((k) => {
              const max = Math.max(...k.trend.map((t) => Math.abs(t.value ?? 0)), 1);
              return (
                <article key={k.code} className="kpi-card">
                  <header>
                    <span className="muted small">{l(...k.area)}</span>
                    <h3 title={l(...k.description)}>{l(...k.label)}</h3>
                  </header>
                  <strong className="kpi-value">{fmt(k, k.value)}</strong>
                  <div className="kpi-compare">
                    {k.change !== null && (
                      <span
                        className={`badge ${k.trendTone === "good" ? "ok" : k.trendTone === "bad" ? "danger" : ""}`}
                      >
                        {k.change > 0 ? "▲" : k.change < 0 ? "▼" : "■"}{" "}
                        {Math.abs(k.change).toLocaleString(locale === "id" ? "id-ID" : "en-US")}%
                      </span>
                    )}
                    <span className="muted small">
                      {l("Periode lalu", "Last period")}: {fmt(k, k.previous)}
                    </span>
                  </div>
                  <div className="kpi-spark" role="img" aria-label={l("Tren 6 bulan", "6-month trend")}>
                    {k.trend.map((t) => (
                      <span
                        key={t.month}
                        title={`${t.month}: ${fmt(k, t.value)}`}
                        style={{ height: `${Math.max(4, (Math.abs(t.value ?? 0) / max) * 100)}%` }}
                        className={t.value === null ? "empty" : undefined}
                      />
                    ))}
                  </div>
                  <p className="muted small">
                    {k.team.size > 1
                      ? [
                          k.team.rank !== null &&
                            l(
                              `Peringkat ${k.team.rank} dari ${k.team.size}`,
                              `Rank ${k.team.rank} of ${k.team.size}`,
                            ),
                          k.team.average !== null &&
                            l(
                              `rata-rata rekan ${fmt(k, k.team.average)}`,
                              `peer average ${fmt(k, k.team.average)}`,
                            ),
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      : l(
                          "Belum ada rekan pembanding di periode ini.",
                          "No peers to compare in this period.",
                        )}
                  </p>
                  <button type="button" className="link" onClick={() => setDetail(k)}>
                    {l(`Lihat data (${k.rows})`, `View data (${k.rows})`)}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="work-section">
        <h2>{l("Jejak kerja saya (30 hari)", "My work trail (30 days)")}</h2>
        {!history ? (
          <p className="muted">{l("Memuat…", "Loading…")}</p>
        ) : !history.total ? (
          <p className="muted">{l("Belum ada aktivitas tercatat.", "No recorded activity yet.")}</p>
        ) : (
          <div className="work-history">
            <div className="work-history-stats">
              {Object.entries(history.byAction).map(([action, count]) => (
                <span key={action} className="pill">
                  {l(...(ACTION[action] ?? [action, action]))}: {n(count)}
                </span>
              ))}
              {history.byModel.slice(0, 6).map((m) => (
                <span key={m.model} className="pill muted">
                  {l(...m.label)}: {n(m.count)}
                </span>
              ))}
            </div>
            <ol className="work-timeline">
              {history.items.slice(0, 60).map((h) => (
                <li key={h.id}>
                  <time className="muted small">
                    {new Date(h.createdAt).toLocaleString(locale === "id" ? "id-ID" : "en-GB", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </time>
                  <span>
                    {l(...(ACTION[h.action] ?? [h.action, h.action]))} {l(...h.modelLabel).toLowerCase()}{" "}
                    {h.href ? <Link href={h.href}>{h.name ?? l("(buka)", "(open)")}</Link> : (h.name ?? "")}
                    {h.action === "update" && h.fields > 0 && (
                      <span className="muted small"> · {l(`${h.fields} field`, `${h.fields} fields`)}</span>
                    )}
                    {h.message && <span className="muted small"> — {h.message}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>

      {detail && <KpiRows kpi={detail} range={range} onClose={() => setDetail(null)} />}
    </>
  );
}

function DocTable({
  docs,
  total,
  showOwner,
  empty,
  more,
}: {
  docs: Doc[];
  total: number;
  showOwner: boolean;
  empty: string;
  more: string | null;
}) {
  const { l, locale } = useI18n();
  if (!docs.length) return <p className="muted">{empty}</p>;
  return (
    <div className="table-wrap">
      <table className="handoff-table">
        <thead>
          <tr>
            <th>{l("Dokumen", "Document")}</th>
            <th>{l("Menunggu", "Waiting for")}</th>
            {showOwner ? <th>{l("Pemegang", "Holder")}</th> : <th>{l("Di", "At")}</th>}
            <th className="num">{l("Umur (hari)", "Age (days)")}</th>
            <th>{l("Batas", "Due")}</th>
            <th>{l("Status", "Status")}</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <tr key={`${d.model}:${d.id}`} className={d.status === "late" ? "row-late" : undefined}>
              <td>
                {d.href ? <Link href={d.href}>{d.name}</Link> : d.name}
                <div className="muted small">
                  {l(...d.processLabel)}
                  {d.partner && ` · ${d.partner}`}
                  {d.value !== null && d.value > 0 && ` · ${money(d.value, locale, 0)}`}
                </div>
              </td>
              <td>
                {l(...d.waiting)}
                <div className="muted small">{l(...d.stageLabel)}</div>
              </td>
              <td>{showOwner ? (d.owner ?? "—") : (d.toDepartment ?? "—")}</td>
              <td className="num">
                {d.ageDays}
                {d.slaDays !== null && <div className="muted small">SLA {d.slaDays}</div>}
              </td>
              <td>{d.due ? formatDate(d.due, locale) : "—"}</td>
              <td>
                <span
                  className={`badge ${d.status === "late" ? "danger" : d.status === "at_risk" ? "warn" : "ok"}`}
                >
                  {d.status === "late"
                    ? l("Terlambat", "Late")
                    : d.status === "at_risk"
                      ? l("Berisiko", "At risk")
                      : l("Tepat waktu", "On time")}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {(total > docs.length || more) && (
        <p className="muted small">
          {total > docs.length &&
            l(`Menampilkan ${docs.length} dari ${total}. `, `Showing ${docs.length} of ${total}. `)}
          {more && <Link href={more}>{l("Buka papan serah terima →", "Open the handoff board →")}</Link>}
        </p>
      )}
    </div>
  );
}

/** Dokumen penyusun satu KPI (rincian yang bisa diklik sampai dokumen sumber). */
function KpiRows({
  kpi,
  range,
  onClose,
}: {
  kpi: KpiResult;
  range: { from: string; to: string };
  onClose: () => void;
}) {
  const { l, locale } = useI18n();
  const [data, setData] = useState<{
    columns: { key: string; header: string; numeric?: boolean }[];
    rows: (Record<string, unknown> & { href: string | null })[];
    total: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<typeof data>(`/me/kpis/${kpi.code}/rows?from=${range.from}&to=${range.to}`).then(
      setData,
      (e: Error) => setError(e.message),
    );
  }, [kpi.code, range.from, range.to]);
  const cell = (v: unknown, numeric?: boolean) =>
    v === null || v === undefined || v === ""
      ? "—"
      : numeric && typeof v === "number"
        ? v.toLocaleString(locale === "id" ? "id-ID" : "en-US")
        : String(v);
  return (
    <Modal
      open
      side
      wide
      title={`${l(...kpi.label)} · ${formatDate(range.from, locale)} – ${formatDate(range.to, locale)}`}
      onClose={onClose}
    >
      <p className="muted small">{l(...kpi.description)}</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p className="muted">{l("Memuat…", "Loading…")}</p>}
      {data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {data.columns.map((c) => (
                  <th key={c.key} className={c.numeric ? "num" : undefined}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={String(r._id ?? i)}>
                  {data.columns.map((c, j) => (
                    <td key={c.key} className={c.numeric ? "num" : undefined}>
                      {j === 0 && r.href ? (
                        <Link href={r.href}>{cell(r[c.key])}</Link>
                      ) : (
                        cell(r[c.key], c.numeric)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {data.total > data.rows.length && (
            <p className="muted small">
              {l(
                `Menampilkan ${data.rows.length} dari ${data.total}.`,
                `Showing ${data.rows.length} of ${data.total}.`,
              )}
            </p>
          )}
          {!data.total && (
            <p className="muted">{l("Tidak ada data di periode ini.", "No data in this period.")}</p>
          )}
        </div>
      )}
    </Modal>
  );
}
