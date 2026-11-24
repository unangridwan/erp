"use client";

import {
  biVisualSchema,
  PERIOD_LABEL,
  PERIOD_PRESETS,
  placeNew,
  VISUAL_TYPE_LABEL,
  type BiDocument,
  type BiFilter,
  type BiPage,
  type BiResult,
  type BiVisual,
  type PeriodPreset,
  type VisualType,
} from "@erp/shared";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "../../../../../components/bi/canvas";
import {
  addField,
  DEFAULT_SIZE,
  EDITOR_VISUALS,
  FieldsPane,
  FilterList,
  newId,
  PageTabs,
  VisualPane,
} from "../../../../../components/bi/editor";
import { VisualBody, type VisualPoint } from "../../../../../components/bi/visual";
import { DatasetDrillPanel, type DatasetDrillRequest } from "../../../../../components/drilldown-panel";
import { ask, toast } from "../../../../../components/feedback";
import { LoadFailed, useLoadError } from "../../../../../components/load-failed";
import { api, ApiError } from "../../../../../lib/api";
import { type BiDatasetInfo } from "../../../../../lib/bi-format";
import { resolvePeriod } from "../../../../../lib/bi-period";
import { useI18n } from "../../../../../lib/i18n";
import { useDirtyGuard } from "../../../../../lib/use-form-guard";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Preset = PeriodPreset | "custom" | "none";

interface Meta {
  name: string;
  description: string;
  visibility: "private" | "shared";
}
interface Loaded {
  doc: BiDocument;
  meta: Meta;
  /** Nama bawaan dwibahasa. */
  title: string | [string, string];
  description: string | [string, string] | null;
  mine: boolean;
  builtin: boolean;
}
interface Draft {
  doc: BiDocument;
  meta: Meta;
}
interface DashboardResponse {
  name: string | [string, string];
  description?: string | [string, string] | null;
  visibility?: "private" | "shared";
  mine?: boolean;
  builtin?: boolean;
  document: BiDocument;
}

/** Visual siap dijalankan: tata letak & judul tidak memengaruhi data. */
const dataKey = (v: BiVisual) => {
  const { layout: _layout, title: _title, ...rest } = v;
  return JSON.stringify(rest);
};
const hasContent = (v: BiVisual) =>
  v.type === "text" || !!v.reportId || v.values.length > 0 || v.columns.length > 0;
const errorText = (e: unknown) => {
  const field = e instanceof ApiError ? Object.values(e.fieldErrors)[0] : undefined;
  return field ?? (e instanceof Error ? e.message : String(e));
};

/** Dashboard BI: lihat (filter periode, halaman, rincian) dan editor kanvas terpadu (kolom · kanvas · visual). */
export default function DashboardPage() {
  const { ref } = useParams<{ ref: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { l, locale } = useI18n();
  const custom = UUID.test(ref);
  const [loadError, failLoad] = useLoadError();
  const [base, setBase] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const history = useRef<{ past: Draft[]; future: Draft[]; at: number; tag: string }>({
    past: [],
    future: [],
    at: 0,
    tag: "",
  });
  const [, setHistoryTick] = useState(0);
  const [pageId, setPageId] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [preset, setPreset] = useState<Preset>("this_year");
  const [customRange, setCustomRange] = useState({ from: "", to: "" });
  const [datasets, setDatasets] = useState<BiDatasetInfo[]>([]);
  const [reports, setReports] = useState<{ id: string; name: string }[]>([]);
  const [activeDataset, setActiveDataset] = useState("");
  const [results, setResults] = useState<Map<string, BiResult>>(new Map());
  const [queryError, setQueryError] = useState<string | null>(null);
  const [drill, setDrill] = useState<DatasetDrillRequest | null>(null);
  const [saving, setSaving] = useState(false);
  const [showPageFilters, setShowPageFilters] = useState(false);

  const startEdit = useCallback((doc: BiDocument, meta: Meta) => {
    history.current = { past: [], future: [], at: 0, tag: "" };
    setDraft({ doc: structuredClone(doc), meta: { ...meta } });
    setResults(new Map());
  }, []);

  useEffect(() => {
    api<DashboardResponse>(custom ? `/dashboards/${ref}` : `/dashboards/builtin/${ref}`)
      .then((d) => {
        const meta: Meta = {
          name: typeof d.name === "string" ? d.name : d.name[0],
          description: typeof d.description === "string" ? d.description : "",
          visibility: d.visibility ?? "private",
        };
        const loaded: Loaded = {
          doc: d.document,
          meta,
          title: d.name,
          description: d.description ?? null,
          mine: !!d.mine,
          builtin: !custom,
        };
        setBase(loaded);
        setPageId(d.document.pages[0]?.id ?? "");
        if (d.document.period) setPreset(d.document.period);
        if (custom && d.mine && search.get("edit")) startEdit(d.document, meta);
      })
      .catch(failLoad);
  }, [ref, custom, search, failLoad, startEdit]);

  const editing = draft !== null;
  const doc = draft?.doc ?? base?.doc ?? null;
  const page: BiPage | null = doc ? (doc.pages.find((p) => p.id === pageId) ?? doc.pages[0] ?? null) : null;

  // Data untuk editor: dataset & laporan tersimpan.
  useEffect(() => {
    if (!editing || datasets.length) return;
    api<BiDatasetInfo[]>("/reports/datasets").then(
      (d) => {
        setDatasets(d);
        setActiveDataset((x) => x || d[0]?.key || "");
      },
      (e) => toast.error(errorText(e)),
    );
    api<{ id: string; name: string }[]>("/saved-reports").then(setReports, () => setReports([]));
  }, [editing, datasets.length]);

  // ---- Periode ----
  const period = resolvePeriod(preset, customRange);
  const rangeIssue =
    preset !== "custom"
      ? null
      : !customRange.from || !customRange.to
        ? l("Isi tanggal Dari dan Sampai untuk menampilkan data.", "Fill in From and To to show data.")
        : customRange.from > customRange.to
          ? l("Tanggal Dari harus sebelum tanggal Sampai.", "From must be before To.")
          : null;

  // ---- Menjalankan visual ----
  const ctxFilters: BiFilter[] = useMemo(
    () => (doc && page ? [...doc.filters, ...page.filters] : []),
    [doc, page],
  );
  const keyFor = useCallback(
    (v: BiVisual) =>
      editing
        ? `e|${dataKey(v)}|${JSON.stringify(ctxFilters)}|${period.from}|${period.to}`
        : `v|${page?.id}|${v.id}|${period.from}|${period.to}`,
    [editing, ctxFilters, period.from, period.to, page?.id],
  );
  const runnable = useMemo(
    () => (page && !rangeIssue ? page.visuals.filter((v) => v.type !== "text" && hasContent(v)) : []),
    [page, rangeIssue],
  );
  const missingKey = runnable
    .filter((v) => !results.has(keyFor(v)))
    .map((v) => keyFor(v))
    .join("\n");

  useEffect(() => {
    if (!missingKey || !page) return;
    const missing = runnable.filter((v) => !results.has(keyFor(v)));
    if (!missing.length) return;
    let alive = true;
    const run = () => {
      const body = editing
        ? { visuals: missing, filters: ctxFilters, from: period.from, to: period.to }
        : {
            ...(custom ? { dashboardId: ref } : { builtin: ref }),
            pageId: page.id,
            from: period.from,
            to: period.to,
          };
      api<{ visuals: BiResult[] }>("/bi/query", { method: "POST", body })
        .then((r) => {
          if (!alive) return;
          setQueryError(null);
          setResults((prev) => {
            const next = new Map(prev);
            const list = editing ? missing : page.visuals.filter((v) => v.type !== "text");
            for (const res of r.visuals) {
              const v = list.find((x) => x.id === res.id);
              if (v) next.set(keyFor(v), res);
            }
            // Batasi cache hasil agar penyuntingan panjang tidak menumpuk memori.
            while (next.size > 200) next.delete(next.keys().next().value!);
            return next;
          });
        })
        .catch((e) => alive && setQueryError(errorText(e)));
    };
    const t = setTimeout(run, editing ? 250 : 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [missingKey]);

  // ---- Riwayat (urungkan/ulangi) ----
  const commit = useCallback((next: Draft, tag = "") => {
    setDraft((cur) => {
      if (!cur) return cur;
      const h = history.current;
      const now = Date.now();
      // Ketikan beruntun pada kontrol yang sama digabung menjadi satu langkah.
      if (!(tag && tag === h.tag && now - h.at < 800)) {
        h.past.push(cur);
        if (h.past.length > 100) h.past.shift();
      }
      h.future = [];
      h.at = now;
      h.tag = tag;
      return next;
    });
    setHistoryTick((t) => t + 1);
  }, []);
  const undo = useCallback(() => {
    setDraft((cur) => {
      const h = history.current;
      const prev = h.past.pop();
      if (!cur || !prev) return cur;
      h.future.push(cur);
      h.tag = "";
      return prev;
    });
    setHistoryTick((t) => t + 1);
  }, []);
  const redo = useCallback(() => {
    setDraft((cur) => {
      const h = history.current;
      const next = h.future.pop();
      if (!cur || !next) return cur;
      h.past.push(cur);
      h.tag = "";
      return next;
    });
    setHistoryTick((t) => t + 1);
  }, []);
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, undo, redo]);

  const dirty =
    !!draft && !!base && JSON.stringify(draft) !== JSON.stringify({ doc: base.doc, meta: base.meta });
  useDirtyGuard(dirty);

  if (loadError) return <LoadFailed message={loadError} />;
  if (!base || !doc || !page) return <p className="muted">{l("Memuat…", "Loading…")}</p>;
  const title = typeof base.title === "string" ? base.title : l(...base.title);
  const description =
    base.description === null
      ? ""
      : typeof base.description === "string"
        ? base.description
        : l(...base.description);

  // ---- Operasi dokumen ----
  const setPage = (p: BiPage, tag = "") =>
    commit(
      { ...draft!, doc: { ...draft!.doc, pages: draft!.doc.pages.map((x) => (x.id === p.id ? p : x)) } },
      tag,
    );
  const setVisual = (v: BiVisual, tag = "") =>
    setPage({ ...page, visuals: page.visuals.map((x) => (x.id === v.id ? v : x)) }, tag);
  const selectedVisual = page.visuals.find((v) => v.id === selected) ?? null;

  const addVisual = (type: VisualType, init?: (v: BiVisual) => BiVisual) => {
    const [w, h] = DEFAULT_SIZE[type];
    const dataset = selectedVisual?.dataset || activeDataset || datasets[0]?.key || "";
    let v = biVisualSchema.parse({
      id: newId(),
      type,
      dataset: type === "text" ? "" : dataset,
      layout: placeNew(page.visuals, w, h),
      ...(type === "text" ? { options: { text: l("Tulis catatan di sini.", "Write a note here.") } } : {}),
    });
    if (init) v = init(v);
    setPage({ ...page, visuals: [...page.visuals, v] });
    setSelected(v.id);
  };
  const removeVisual = (id: string) => {
    setPage({ ...page, visuals: page.visuals.filter((v) => v.id !== id) });
    if (selected === id) setSelected(null);
  };
  const duplicateVisual = (v: BiVisual) => {
    const copy = {
      ...structuredClone(v),
      id: newId(),
      layout: placeNew(page.visuals, v.layout.w, v.layout.h),
    };
    setPage({ ...page, visuals: [...page.visuals, copy] });
    setSelected(copy.id);
  };
  const fieldsDataset =
    selectedVisual && selectedVisual.type !== "text" && !selectedVisual.reportId
      ? selectedVisual.dataset
      : activeDataset;
  const onFieldsDataset = async (key: string) => {
    if (selectedVisual && selectedVisual.type !== "text" && !selectedVisual.reportId) {
      if (selectedVisual.dataset === key) return;
      const used =
        selectedVisual.axis.length ||
        selectedVisual.values.length ||
        selectedVisual.columns.length ||
        selectedVisual.legend;
      if (
        used &&
        !(await ask({
          message: l(
            "Ganti data visual ini? Kolom yang sudah dipilih akan dikosongkan.",
            "Change this visual's data? Its selected fields will be cleared.",
          ),
        }))
      )
        return;
      setVisual({
        ...selectedVisual,
        dataset: key,
        params: {},
        axis: [],
        legend: null,
        values: [],
        columns: [],
        filters: [],
        sort: null,
      });
    }
    setActiveDataset(key);
  };
  const onAddField = (f: Parameters<typeof addField>[1]) => {
    const target =
      selectedVisual && selectedVisual.type !== "text" && !selectedVisual.reportId ? selectedVisual : null;
    if (target && target.dataset === fieldsDataset) setVisual(addField(target, f));
    else addVisual(f.numeric ? "card" : "column", (v) => addField({ ...v, dataset: fieldsDataset }, f));
  };

  // ---- Simpan / batal / aksi ----
  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      await api(`/dashboards/${ref}`, {
        method: "PATCH",
        body: {
          name: draft.meta.name,
          description: draft.meta.description || null,
          visibility: draft.meta.visibility,
          widgets: [],
          document: draft.doc,
        },
      });
      setBase({
        ...base!,
        doc: draft.doc,
        meta: draft.meta,
        title: draft.meta.name,
        description: draft.meta.description || null,
      });
      setDraft(null);
      setSelected(null);
      setResults(new Map());
      toast.success(l("Dashboard disimpan.", "Dashboard saved."));
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSaving(false);
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
    setSelected(null);
    setResults(new Map());
    if (!base!.doc.pages.some((p) => p.id === pageId)) setPageId(base!.doc.pages[0]!.id);
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

  const openDrill = (v: BiVisual, p: VisualPoint) => {
    const name = v.title || l(...VISUAL_TYPE_LABEL[v.type]);
    if (v.reportId)
      setDrill({
        title: `${name}${p.label ? ` · ${p.label}` : ""}`,
        body: {
          reportId: v.reportId,
          match: Object.fromEntries(p.match.map((m) => [m.column, m.value])),
          filters: !v.ignorePeriod && period.from && period.to ? { from: period.from, to: period.to } : {},
        },
      });
    else
      setDrill({
        title: `${name}${p.label ? ` · ${p.label}` : ""}`,
        endpoint: "/bi/drill",
        body: { visual: v, from: period.from, to: period.to, filters: ctxFilters, match: p.match },
      });
  };

  /** Judul otomatis visual tanpa judul: "Ukuran per Field" dari hasil. */
  const autoTitle = (v: BiVisual) => {
    const r = results.get(keyFor(v));
    if (!r || v.type === "text") return "";
    const measures = r.fields.filter((f) => f.kind === "measure").map((f) => f.header);
    const dims = r.fields.filter((f) => f.kind === "dimension").map((f) => f.header);
    if (v.type === "table" && !v.values.length) return "";
    return `${measures.join(", ")}${dims.length ? ` ${l("per", "by")} ${dims.join(", ")}` : ""}`;
  };
  const renderHeader = (v: BiVisual) => (
    <>
      <h3 title={v.title || autoTitle(v)}>
        {v.reportId && !editing ? (
          <Link href={`/bi/reports/${v.reportId}`}>{v.title || l("Laporan", "Report")}</Link>
        ) : (
          v.title ||
          autoTitle(v) ||
          (editing ? <span className="muted">{l(...VISUAL_TYPE_LABEL[v.type])}</span> : null)
        )}
      </h3>
      {editing && (
        <span className="dash-widget-tools" onPointerDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="link"
            title={l("Duplikat visual", "Duplicate visual")}
            onClick={() => duplicateVisual(v)}
          >
            ⧉
          </button>
          <button
            type="button"
            className="link danger"
            title={l("Hapus visual", "Remove visual")}
            aria-label={l("Hapus visual", "Remove visual")}
            onClick={() => removeVisual(v.id)}
          >
            ×
          </button>
        </span>
      )}
    </>
  );
  const renderBody = (v: BiVisual) => {
    if (editing && !hasContent(v))
      return (
        <p className="muted small bi-empty">
          {l(
            "Pilih visual ini lalu tambahkan kolom dari panel Data.",
            "Select this visual, then add fields from the Data pane.",
          )}
        </p>
      );
    if (rangeIssue && v.type !== "text") return <p className="muted small">—</p>;
    return (
      <VisualBody
        visual={v}
        result={v.type === "text" ? undefined : results.get(keyFor(v))}
        onPoint={editing ? undefined : (p) => openDrill(v, p)}
      />
    );
  };

  const periodControls = (
    <div className="cp-right dash-period">
      <select
        aria-label={l("Periode", "Period")}
        value={preset}
        onChange={(e) => setPreset(e.target.value as Preset)}
      >
        {PERIOD_PRESETS.map((p) => (
          <option key={p} value={p}>
            {l(...PERIOD_LABEL[p])}
          </option>
        ))}
        <option value="none">{l("Semua waktu", "All time")}</option>
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
      ) : preset !== "none" ? (
        <span className="muted small">
          {new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", {
            dateStyle: "medium",
            timeZone: "UTC",
          }).formatRange(new Date(`${period.from}T00:00:00Z`), new Date(`${period.to}T00:00:00Z`))}
        </span>
      ) : null}
    </div>
  );

  const pageColumns = (() => {
    const keys = new Set(page.visuals.map((v) => v.dataset).filter(Boolean));
    const seen = new Map<string, { key: string; header: string; numeric: boolean }>();
    for (const d of datasets.filter((x) => keys.has(x.key)))
      for (const c of d.columns)
        if (!seen.has(c.key)) seen.set(c.key, { key: c.key, header: c.header, numeric: c.numeric });
    return [...seen.values()];
  })();

  return (
    <div className={`bi-dashboard${editing ? " editing" : ""}`}>
      <header className="toolbar control-panel">
        <div className="cp-left">
          <nav className="breadcrumb">
            <Link href="/bi">{l("Dashboard", "Dashboards")}</Link>
            <span>/</span>
            {editing ? (
              <input
                aria-label={l("Nama dashboard", "Dashboard name")}
                value={draft.meta.name}
                maxLength={120}
                onChange={(e) => commit({ ...draft, meta: { ...draft.meta, name: e.target.value } }, "name")}
              />
            ) : (
              <h1>{title}</h1>
            )}
          </nav>
          {editing ? (
            <>
              <button
                className="primary"
                disabled={saving || !draft.meta.name.trim()}
                aria-busy={saving}
                onClick={() => void save()}
              >
                {l("Simpan", "Save")}
              </button>
              <button type="button" onClick={() => void cancelEdit()}>
                {l("Batal", "Cancel")}
              </button>
              <button
                type="button"
                title={l("Urungkan (Ctrl+Z)", "Undo (Ctrl+Z)")}
                disabled={!history.current.past.length}
                onClick={undo}
              >
                ↶
              </button>
              <button
                type="button"
                title={l("Ulangi (Ctrl+Y)", "Redo (Ctrl+Y)")}
                disabled={!history.current.future.length}
                onClick={redo}
              >
                ↷
              </button>
              <select
                aria-label={l("Tambah visual", "Add visual")}
                value=""
                onChange={(e) => e.target.value && addVisual(e.target.value as VisualType)}
              >
                <option value="">+ {l("Tambah visual", "Add visual")}</option>
                {EDITOR_VISUALS.map((t) => (
                  <option key={t} value={t}>
                    {l(...VISUAL_TYPE_LABEL[t])}
                  </option>
                ))}
              </select>
              <select
                aria-label={l("Dibagikan", "Sharing")}
                value={draft.meta.visibility}
                onChange={(e) =>
                  commit({
                    ...draft,
                    meta: { ...draft.meta, visibility: e.target.value as Meta["visibility"] },
                  })
                }
              >
                <option value="private">{l("Pribadi", "Private")}</option>
                <option value="shared">
                  {l("Dibagikan ke semua pengguna perusahaan", "Shared with the company")}
                </option>
              </select>
            </>
          ) : (
            <>
              {custom && base.mine && (
                <button type="button" className="primary" onClick={() => startEdit(base.doc, base.meta)}>
                  {l("Ubah", "Edit")}
                </button>
              )}
              <button type="button" onClick={() => void duplicate()}>
                {l("Duplikat", "Duplicate")}
              </button>
              <button type="button" onClick={() => void pin()}>
                ☆ {l("Sematkan di Beranda", "Pin to Home")}
              </button>
              {custom && base.mine && (
                <button type="button" className="danger" onClick={() => void remove()}>
                  {l("Hapus", "Delete")}
                </button>
              )}
            </>
          )}
        </div>
        {periodControls}
      </header>
      {!editing && description && <p className="muted">{description}</p>}
      {rangeIssue ? (
        <p className={customRange.from && customRange.to ? "error" : "muted"} role="status">
          {rangeIssue}
        </p>
      ) : (
        queryError && (
          <p className="error" role="alert">
            {queryError}
          </p>
        )
      )}

      <div className={editing ? "bi-editor" : "bi-view"}>
        {editing && (
          <FieldsPane
            datasets={datasets}
            dataset={fieldsDataset}
            onDataset={(k) => void onFieldsDataset(k)}
            onAdd={onAddField}
          />
        )}
        <div className="bi-stage">
          {editing && (page.filters.length > 0 || doc.filters.length > 0 || showPageFilters) && (
            <div className="bi-page-filters">
              <h3>{l("Filter halaman ini", "Filters on this page")}</h3>
              <FilterList
                filters={page.filters}
                columns={pageColumns}
                onChange={(filters) => setPage({ ...page, filters }, "page-filter")}
                empty={l("Belum ada.", "None yet.")}
              />
              <h3>{l("Filter semua halaman", "Filters on all pages")}</h3>
              <FilterList
                filters={doc.filters}
                columns={pageColumns}
                onChange={(filters) => commit({ ...draft!, doc: { ...draft!.doc, filters } }, "doc-filter")}
                empty={l("Belum ada.", "None yet.")}
              />
            </div>
          )}
          {editing && !(page.filters.length > 0 || doc.filters.length > 0 || showPageFilters) && (
            <p className="bi-stage-tools">
              <button type="button" className="link" onClick={() => setShowPageFilters(true)}>
                + {l("Filter halaman / semua halaman", "Page / all-pages filters")}
              </button>
            </p>
          )}
          {!editing && (page.filters.length > 0 || doc.filters.length > 0) && (
            <p className="muted small">
              {l("Filter aktif", "Active filters")}:{" "}
              {[...doc.filters, ...page.filters]
                .map(
                  (f) =>
                    `${f.column}${f.level ? ` (${f.level})` : ""} ${f.op === "in" ? f.values.join(", ") : `${f.op} ${f.value}`}`,
                )
                .join(" · ")}
            </p>
          )}
          {page.visuals.length === 0 && (
            <p className="muted bi-empty">
              {editing
                ? l(
                    'Halaman kosong. Pilih jenis di "Tambah visual" atau klik kolom di panel Data.',
                    'This page is empty. Pick a type in "Add visual" or click a field in the Data pane.',
                  )
                : l("Belum ada visual di halaman ini.", "No visuals on this page yet.")}
            </p>
          )}
          <Canvas
            visuals={page.visuals}
            editing={editing}
            selected={selected}
            onSelect={setSelected}
            onLayout={(visuals) => setPage({ ...page, visuals })}
            onDelete={removeVisual}
            renderHeader={renderHeader}
            renderBody={renderBody}
          />
          <PageTabs
            pages={doc.pages}
            current={page.id}
            editing={editing}
            onSelect={(id) => {
              setPageId(id);
              setSelected(null);
            }}
            onChange={(pages, select) => {
              commit({ ...draft!, doc: { ...draft!.doc, pages } });
              if (select) {
                setPageId(select);
                setSelected(null);
              }
            }}
          />
        </div>
        {editing &&
          (selectedVisual ? (
            <VisualPane
              key={selectedVisual.id}
              visual={selectedVisual}
              datasets={datasets}
              reports={reports}
              onChange={(v) => setVisual(v, `visual:${v.id}`)}
            />
          ) : (
            <aside className="bi-pane bi-visual-pane">
              <h2>{l("Visual", "Visual")}</h2>
              <p className="muted small">
                {l(
                  "Pilih visual di kanvas untuk mengatur data, format, dan filternya. Seret judul visual untuk memindah, seret sudut kanan bawah untuk mengubah ukuran.",
                  "Select a visual on the canvas to set its data, format and filters. Drag a visual's title to move it and its bottom-right corner to resize it.",
                )}
              </p>
              <label className="field">
                <span>{l("Deskripsi dashboard", "Dashboard description")}</span>
                <textarea
                  rows={3}
                  maxLength={500}
                  value={draft.meta.description}
                  onChange={(e) =>
                    commit({ ...draft, meta: { ...draft.meta, description: e.target.value } }, "desc")
                  }
                />
              </label>
              <label className="field">
                <span>{l("Periode bawaan", "Default period")}</span>
                <select
                  value={doc.period ?? ""}
                  onChange={(e) =>
                    commit({
                      ...draft,
                      doc: { ...draft.doc, period: (e.target.value || null) as PeriodPreset | null },
                    })
                  }
                >
                  <option value="">{l("Tahun ini", "This year")}</option>
                  {PERIOD_PRESETS.map((p) => (
                    <option key={p} value={p}>
                      {l(...PERIOD_LABEL[p])}
                    </option>
                  ))}
                </select>
              </label>
            </aside>
          ))}
      </div>
      <DatasetDrillPanel request={drill} onClose={() => setDrill(null)} />
    </div>
  );
}
