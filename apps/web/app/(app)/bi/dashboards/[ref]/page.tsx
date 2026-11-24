"use client";

import {
  PERIOD_LABEL,
  PERIOD_PRESETS,
  REPORT_AGGREGATE_LABEL,
  WIDGET_TYPE_LABEL,
  WIDGET_TYPES,
  type PeriodPreset,
  type ReportAggregate,
  type WidgetType,
} from "@erp/shared";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  DashboardGrid,
  resolvePeriod,
  useWidgetResults,
  type Widget,
} from "../../../../../components/bi/dashboard-grid";
import { ask, Modal, toast } from "../../../../../components/feedback";
import { LoadFailed, useLoadError } from "../../../../../components/load-failed";
import { useMe } from "../../../../../components/me-context";
import { api } from "../../../../../lib/api";
import { DATASET_APPS, type DashboardDoc, type DatasetInfo } from "../../../../../lib/bi";
import { useI18n } from "../../../../../lib/i18n";
import { useDirtyGuard } from "../../../../../lib/use-form-guard";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Kolom kelompok berupa waktu: diurutkan menurut waktu, bukan nilai, dan tidak dibatasi "teratas". */
const TIME_COLUMN = /date|month|period|created|closed|scheduled|finished|breakdown/i;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const newId = () => `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Dashboard bawaan (`/bi/dashboards/sales`) atau kustom (`/bi/dashboards/<uuid>`), dengan periode & mode ubah. */
export default function DashboardPage() {
  const { ref } = useParams<{ ref: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const me = useMe();
  const { l, locale } = useI18n();
  const custom = UUID.test(ref);
  const [doc, setDoc] = useState<DashboardDoc | null>(null);
  const [draft, setDraft] = useState<Widget[] | null>(null);
  const [meta, setMeta] = useState({
    name: "",
    description: "",
    visibility: "private" as "private" | "shared",
  });
  const [preset, setPreset] = useState<PeriodPreset | "custom">("this_year");
  const [customRange, setCustomRange] = useState({ from: "", to: "" });
  const [adding, setAdding] = useState(false);
  const [version, setVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loadError, failLoad] = useLoadError();

  useEffect(() => {
    api<DashboardDoc>(custom ? `/dashboards/${ref}` : `/dashboards/builtin/${ref}`)
      .then((d) => {
        setDoc(d);
        if (d.period) setPreset(d.period);
        if (typeof d.name === "string")
          setMeta({
            name: d.name,
            description: (d.description as string) ?? "",
            visibility: d.visibility ?? "private",
          });
        if (custom && d.mine && search.get("edit")) setDraft(d.widgets);
      })
      .catch(failLoad);
  }, [ref, custom, search, failLoad]);

  const period = resolvePeriod(preset, customRange);
  const editing = draft !== null;
  const widgets = (draft ?? doc?.widgets ?? []) as Widget[];
  const runBody = useMemo(
    () => (!doc ? null : editing ? { widgets: draft! } : custom ? { dashboardId: ref } : { builtin: ref }),
    [doc, editing, draft, custom, ref],
  );
  // Rentang kustom dijalankan hanya bila lengkap dan tidak terbalik.
  const rangeIssue =
    preset !== "custom"
      ? null
      : !customRange.from || !customRange.to
        ? l("Isi tanggal Dari dan Sampai untuk menampilkan data.", "Fill in From and To to show data.")
        : customRange.from > customRange.to
          ? l("Tanggal Dari harus sebelum tanggal Sampai.", "From must be before To.")
          : null;
  const { results, error } = useWidgetResults(rangeIssue ? null : runBody, period, version);
  const dirty =
    editing &&
    !!doc &&
    (JSON.stringify(draft) !== JSON.stringify(doc.widgets) ||
      (typeof doc.name === "string" &&
        (meta.name !== doc.name ||
          meta.description !== ((doc.description as string) ?? "") ||
          meta.visibility !== (doc.visibility ?? "private"))));
  useDirtyGuard(dirty);

  if (loadError) return <LoadFailed message={loadError} />;
  if (!doc) return <p className="muted">{l("Memuat…", "Loading…")}</p>;
  const title = typeof doc.name === "string" ? doc.name : l(...doc.name);

  async function save() {
    setSaving(true);
    try {
      const body = { ...meta, description: meta.description || null, widgets: draft };
      const saved = await api<DashboardDoc>(`/dashboards/${ref}`, { method: "PATCH", body });
      setDoc({ ...doc!, ...saved, mine: true });
      setDraft(null);
      setVersion((v) => v + 1);
      toast.success(l("Dashboard disimpan.", "Dashboard saved."));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function duplicate() {
    try {
      const copy = await api<{ id: string }>("/dashboards/duplicate", {
        method: "POST",
        body: custom ? { dashboardId: ref } : { builtin: ref },
      });
      toast.success(l("Salinan dibuat; Anda bisa mengubahnya.", "Copy created; you can edit it."));
      router.push(`/bi/dashboards/${copy.id}?edit=1`);
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  async function cancelEdit() {
    if (
      dirty &&
      !(await ask({
        message: l("Buang perubahan dashboard ini?", "Discard changes to this dashboard?"),
        danger: true,
      }))
    )
      return;
    setDraft(null);
    if (typeof doc!.name === "string")
      setMeta({
        name: doc!.name,
        description: (doc!.description as string) ?? "",
        visibility: doc!.visibility ?? "private",
      });
  }

  async function remove() {
    if (
      !(await ask({
        message: l(`Hapus dashboard "${title}"?`, `Delete dashboard "${title}"?`),
        danger: true,
      }))
    )
      return;
    try {
      await api(`/dashboards/${ref}`, { method: "DELETE" });
      toast.success(l("Dashboard dihapus.", "Dashboard deleted."));
      router.replace("/bi");
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  async function pin() {
    try {
      const pins = await api<string[]>("/me/dashboard-pins");
      const key = custom ? ref : `builtin:${ref}`;
      if (pins.includes(key)) return toast.info(l("Sudah disematkan di Beranda.", "Already pinned to Home."));
      await api("/me/dashboard-pins", { method: "PUT", body: { refs: [...pins, key] } });
      toast.success(l("Disematkan di Beranda.", "Pinned to Home."));
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  return (
    <>
      <header className="toolbar control-panel">
        <div className="cp-left">
          <nav className="breadcrumb">
            <Link href="/bi">{l("Dashboard", "Dashboards")}</Link>
            <span>/</span>
            {editing ? (
              <input
                aria-label={l("Nama dashboard", "Dashboard name")}
                value={meta.name}
                maxLength={120}
                onChange={(e) => setMeta((m) => ({ ...m, name: e.target.value }))}
              />
            ) : (
              <h1>{title}</h1>
            )}
          </nav>
          {editing ? (
            <>
              <button
                className="primary"
                disabled={saving || !meta.name.trim()}
                aria-busy={saving}
                onClick={save}
              >
                {l("Simpan", "Save")}
              </button>
              <button type="button" onClick={() => setAdding(true)}>
                {l("Tambah widget", "Add widget")}
              </button>
              <select
                aria-label={l("Dibagikan", "Sharing")}
                value={meta.visibility}
                onChange={(e) =>
                  setMeta((m) => ({ ...m, visibility: e.target.value as "private" | "shared" }))
                }
              >
                <option value="private">{l("Pribadi", "Private")}</option>
                <option value="shared">
                  {l("Dibagikan ke semua pengguna perusahaan", "Shared with the company")}
                </option>
              </select>
              <button type="button" onClick={() => void cancelEdit()}>
                {l("Batal", "Cancel")}
              </button>
            </>
          ) : (
            <>
              {custom && doc.mine && (
                <button type="button" className="primary" onClick={() => setDraft(doc.widgets)}>
                  {l("Ubah", "Edit")}
                </button>
              )}
              <button type="button" onClick={() => void duplicate()}>
                {l("Duplikat", "Duplicate")}
              </button>
              <button type="button" onClick={() => void pin()}>
                ☆ {l("Sematkan di Beranda", "Pin to Home")}
              </button>
              {custom && doc.mine && (
                <button type="button" className="danger" onClick={() => void remove()}>
                  {l("Hapus", "Delete")}
                </button>
              )}
            </>
          )}
        </div>
        <div className="cp-right dash-period">
          <select
            aria-label={l("Periode", "Period")}
            value={preset}
            onChange={(e) => setPreset(e.target.value as PeriodPreset | "custom")}
          >
            {PERIOD_PRESETS.map((p) => (
              <option key={p} value={p}>
                {l(...PERIOD_LABEL[p])}
              </option>
            ))}
            <option value="custom">{l("Rentang kustom", "Custom range")}</option>
          </select>
          {preset === "custom" ? (
            <>
              <input
                type="date"
                aria-label={l("Dari", "From")}
                value={customRange.from}
                onChange={(e) => setCustomRange((r) => ({ ...r, from: e.target.value }))}
              />
              <input
                type="date"
                aria-label={l("Sampai", "To")}
                value={customRange.to}
                onChange={(e) => setCustomRange((r) => ({ ...r, to: e.target.value }))}
              />
            </>
          ) : (
            <span className="muted small">
              {new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", {
                dateStyle: "medium",
                timeZone: "UTC",
              }).formatRange(new Date(`${period.from}T00:00:00Z`), new Date(`${period.to}T00:00:00Z`))}
            </span>
          )}
        </div>
      </header>
      {editing && (
        <p className="muted small">
          {l(
            "Atur judul, lebar (1–4 kolom), dan urutan widget, lalu Simpan. Data mengikuti hak akses masing-masing pembaca.",
            "Set widget titles, widths (1–4 columns) and order, then Save. Data follows each viewer's access rights.",
          )}
        </p>
      )}
      {typeof doc.description === "string" && doc.description && !editing && (
        <p className="muted">{doc.description}</p>
      )}
      {rangeIssue ? (
        <p className={customRange.from && customRange.to ? "error" : "muted"} role="status">
          {rangeIssue}
        </p>
      ) : (
        error && (
          <p className="error" role="alert">
            {error}
          </p>
        )
      )}
      <DashboardGrid
        widgets={widgets}
        results={results}
        editing={editing}
        onChange={setDraft}
        reportHref={(w) => ("reportId" in w.source ? `/bi/reports/${w.source.reportId}` : undefined)}
        period={period}
        idle={!!rangeIssue}
      />
      {adding && (
        <AddWidget
          me={me.permissions}
          onClose={() => setAdding(false)}
          onAdd={(w) => {
            setDraft((d) => [...(d ?? []), w]);
            setAdding(false);
          }}
        />
      )}
    </>
  );
}

/** Dialog tambah widget: dari laporan tersimpan atau atur cepat (data → kelompok → agregasi → tampilan). */
function AddWidget({ onClose, onAdd }: { me: string[]; onClose: () => void; onAdd: (w: Widget) => void }) {
  const { l } = useI18n();
  const [mode, setMode] = useState<"quick" | "report">("quick");
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [reports, setReports] = useState<{ id: string; name: string }[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [f, setF] = useState({
    title: "",
    type: "bar" as WidgetType,
    dataset: "",
    group: "",
    fn: "sum" as ReportAggregate,
    column: "",
    limit: "10",
    reportId: "",
    compare: true,
    ignorePeriod: false,
  });
  useEffect(() => {
    api<DatasetInfo[]>("/reports/datasets").then(
      (d) => {
        setDatasets(d);
        setF((x) => ({ ...x, dataset: x.dataset || d[0]?.key || "" }));
      },
      (e) => setLoadError(errorText(e)),
    );
    api<{ id: string; name: string }[]>("/saved-reports").then(setReports, () => setReports([]));
  }, []);
  const ds = datasets.find((d) => d.key === f.dataset);
  const numeric = ds?.columns.filter((c) => c.numeric) ?? [];
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  function build(): Widget | null {
    const base = {
      id: newId(),
      title: f.title.trim(),
      type: f.type,
      width: f.type === "kpi" ? 1 : 2,
      compare: f.type === "kpi" && f.compare,
      ignorePeriod: f.ignorePeriod,
    };
    if (mode === "report") {
      if (!f.reportId) return null;
      return {
        ...base,
        title: base.title || reports.find((r) => r.id === f.reportId)?.name || "",
        source: { reportId: f.reportId },
      };
    }
    if (!ds) return null;
    const column = f.fn === "count" ? "*" : f.column;
    if (!column) return null;
    const aggKey = `${f.fn}__${column}`;
    const group = f.type === "kpi" ? "" : f.group;
    // Garis = tren: selalu urut menurut kelompok.
    const byTime = f.type === "line" || TIME_COLUMN.test(group);
    return {
      ...base,
      title:
        base.title ||
        `${l(...REPORT_AGGREGATE_LABEL[f.fn])} ${f.fn === "count" ? l("data", "records") : (numeric.find((c) => c.key === column)?.header ?? column)}${group ? ` ${l("per", "by")} ${ds.columns.find((c) => c.key === group)?.header ?? group}` : ""}`,
      source: {
        dataset: ds.key,
        config: {
          columns: [],
          filters: {},
          conditions: [],
          groupBy: group ? [group] : [],
          aggregates: [{ column, fn: f.fn }],
          sort: group ? (byTime ? { column: group, dir: "asc" } : { column: aggKey, dir: "desc" }) : null,
          limit: group && !byTime && Number(f.limit) ? Number(f.limit) : null,
          chart:
            group && (f.type === "bar" || f.type === "line" || f.type === "pie")
              ? { type: f.type, x: group, y: aggKey }
              : null,
        },
      },
    };
  }
  const widget = build();
  const valid = !!widget && (mode === "report" || f.type === "kpi" || !!f.group);

  return (
    <Modal
      open
      wide
      title={l("Tambah widget", "Add widget")}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            {l("Batal", "Cancel")}
          </button>
          <button type="button" className="primary" disabled={!valid} onClick={() => widget && onAdd(widget)}>
            {l("Tambah", "Add")}
          </button>
        </>
      }
    >
      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "quick"}
          className={mode === "quick" ? "active" : ""}
          onClick={() => setMode("quick")}
        >
          {l("Atur cepat", "Quick setup")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "report"}
          className={mode === "report" ? "active" : ""}
          onClick={() => setMode("report")}
        >
          {l("Dari laporan tersimpan", "From a saved report")}
        </button>
      </div>
      {loadError && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}
      <div className="fields">
        <label className="field">
          <span>{l("Judul", "Title")}</span>
          <input
            value={f.title}
            maxLength={120}
            placeholder={l("Otomatis bila kosong", "Automatic if empty")}
            onChange={(e) => set("title", e.target.value)}
          />
        </label>
        <label className="field">
          <span>{l("Tampilan", "Display")}</span>
          <select value={f.type} onChange={(e) => set("type", e.target.value as WidgetType)}>
            {WIDGET_TYPES.map((t) => (
              <option key={t} value={t}>
                {l(...WIDGET_TYPE_LABEL[t])}
              </option>
            ))}
          </select>
        </label>
        {mode === "report" ? (
          <label className="field">
            <span>{l("Laporan", "Report")} *</span>
            <select value={f.reportId} onChange={(e) => set("reportId", e.target.value)}>
              <option value="">—</option>
              {reports.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <small className="muted">
              {l(
                "Grafik memakai pengaturan grafik di laporan; tanpa grafik tampil sebagai tabel.",
                "Charts use the report's chart settings; otherwise shown as a table.",
              )}
            </small>
          </label>
        ) : (
          <>
            <label className="field">
              <span>{l("Data", "Data")} *</span>
              <select
                value={f.dataset}
                onChange={(e) => setF((x) => ({ ...x, dataset: e.target.value, group: "", column: "" }))}
              >
                {[...new Set(datasets.map((d) => d.app))].map((app) => (
                  <optgroup key={app} label={l(...(DATASET_APPS[app] ?? [app, app]))}>
                    {datasets
                      .filter((d) => d.app === app)
                      .map((d) => (
                        <option key={d.key} value={d.key}>
                          {d.label}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </label>
            {f.type !== "kpi" && (
              <label className="field">
                <span>{l("Kelompokkan per", "Group by")} *</span>
                <select value={f.group} onChange={(e) => set("group", e.target.value)}>
                  <option value="">—</option>
                  {ds?.columns
                    .filter((c) => !c.numeric)
                    .map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.header}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label className="field">
              <span>{l("Hitung", "Measure")}</span>
              <select value={f.fn} onChange={(e) => set("fn", e.target.value as ReportAggregate)}>
                {(Object.keys(REPORT_AGGREGATE_LABEL) as ReportAggregate[]).map((a) => (
                  <option key={a} value={a}>
                    {l(...REPORT_AGGREGATE_LABEL[a])}
                  </option>
                ))}
              </select>
            </label>
            {f.fn !== "count" && (
              <label className="field">
                <span>{l("Kolom angka", "Numeric column")} *</span>
                <select value={f.column} onChange={(e) => set("column", e.target.value)}>
                  <option value="">—</option>
                  {numeric.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.header}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {f.type !== "kpi" && (
              <label className="field">
                <span>{l("Batasi (teratas)", "Limit (top)")}</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={f.limit}
                  onChange={(e) => set("limit", e.target.value)}
                />
              </label>
            )}
          </>
        )}
        {f.type === "kpi" && (
          <label className="field check">
            <span>{l("Bandingkan dengan periode lalu", "Compare with previous period")}</span>
            <input type="checkbox" checked={f.compare} onChange={(e) => set("compare", e.target.checked)} />
          </label>
        )}
        <label className="field check">
          <span>{l("Abaikan periode (nilai saat ini)", "Ignore period (current value)")}</span>
          <input
            type="checkbox"
            checked={f.ignorePeriod}
            onChange={(e) => set("ignorePeriod", e.target.checked)}
          />
        </label>
      </div>
    </Modal>
  );
}
