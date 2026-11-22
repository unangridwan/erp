"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { PRIORITY_LABEL } from "@erp/shared";
import { useCallback, useEffect, useState } from "react";
import { useOptions } from "../../../../../components/accounting/use-options";
import { CustomFieldsSection } from "../../../../../components/custom-fields";
import { ask, toast } from "../../../../../components/feedback";
import { priorityLabel, StateBadge } from "../../../../../components/maintenance/maintenance-panels";
import { useMe } from "../../../../../components/me-context";
import { api, ApiError } from "../../../../../lib/api";
import { money } from "../../../../../lib/format";
import { useI18n } from "../../../../../lib/i18n";
import { can } from "../../../../../lib/resources";
import { RelatedDocuments } from "../../../../../components/related-documents";
import { LoadFailed, useLoadError } from "../../../../../components/load-failed";

interface Part {
  productId: string;
  product?: string;
  sku?: string;
  quantity: string;
  locationId: string | null;
  lotName: string | null;
  cost?: string | null;
}
interface Detail {
  id: string;
  name: string;
  equipmentId: string;
  kind: "preventive" | "corrective";
  title: string;
  description: string | null;
  priority: string;
  teamId: string | null;
  technicianUserId: string | null;
  scheduledDate: string | null;
  state: string;
  breakdownAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  downtimeHours: string | null;
  checklist: { label: string; done: boolean }[];
  resolution: string | null;
  laborHours: string | null;
  laborCost: string;
  vendorId: string | null;
  vendorCost: string;
  moveId: string | null;
  partsCost: string;
  partsMoveId: string | null;
  planId: string | null;
  custom: Record<string, unknown>;
  equipment: { id: string; code: string; name: string; meterUnit: string | null; meter: string };
  parts: Part[];
  totalCost: string;
}
interface Option {
  id: string;
  name: string;
}

const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

/** Form permintaan perawatan: detail, checklist, suku cadang, biaya, alur Mulai → Selesai, tagihan vendor. */
export default function MaintenanceRequestPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { l, locale } = useI18n();
  const [loadError, failLoad] = useLoadError();
  const me = useMe();
  const isNew = params.id === "new";
  const [data, setData] = useState<Detail | null>(null);
  const [form, setForm] = useState({
    equipmentId: search.get("equipmentId") ?? "",
    kind: "corrective" as "preventive" | "corrective",
    title: "",
    description: "",
    priority: "normal",
    teamId: "",
    technicianUserId: "",
    scheduledDate: "",
    breakdownAt: "",
    vendorId: "",
    vendorCost: "0",
    laborCost: "0",
    laborHours: "",
    resolution: "",
    checklist: [] as { label: string; done: boolean }[],
    custom: {} as Record<string, unknown>,
  });
  const [parts, setParts] = useState<Part[]>([]);
  const [meter, setMeter] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const equipment = useOptions<{ id: string; code: string; name: string }>("/equipment");
  const teams = useOptions<Option>("/maintenance-teams");
  const users = useOptions<Option>("/users/options");
  const vendors = useOptions<Option>("/partners");
  const products = useOptions<{ id: string; sku: string; name: string; productType: string }>("/products");
  const locations = useOptions<{ id: string; completeName: string }>("/stock-locations?usage=internal");

  const fill = useCallback((d: Detail) => {
    setData(d);
    setForm({
      equipmentId: d.equipmentId,
      kind: d.kind,
      title: d.title,
      description: d.description ?? "",
      priority: d.priority,
      teamId: d.teamId ?? "",
      technicianUserId: d.technicianUserId ?? "",
      scheduledDate: d.scheduledDate ?? "",
      breakdownAt: toLocalInput(d.breakdownAt),
      vendorId: d.vendorId ?? "",
      vendorCost: d.vendorCost,
      laborCost: d.laborCost,
      laborHours: d.laborHours ?? "",
      resolution: d.resolution ?? "",
      checklist: d.checklist,
      custom: d.custom ?? {},
    });
    setParts(d.parts);
  }, []);

  const load = useCallback(() => {
    if (isNew) return;
    api<Detail>(`/maintenance-requests/${params.id}`).then(fill).catch(failLoad);
  }, [isNew, params.id, fill]);
  useEffect(load, [load]);

  const locked = !!data && (data.state === "done" || data.state === "cancelled");
  const canWrite = can(me.permissions, "maintenance.write") && !locked;
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const err = (k: string) => (errors[k] ? <small className="error">{errors[k]}</small> : null);

  const body = () => ({
    equipmentId: form.equipmentId,
    kind: form.kind,
    title: form.title,
    description: form.description || null,
    priority: form.priority,
    teamId: form.teamId || null,
    technicianUserId: form.technicianUserId || null,
    scheduledDate: form.scheduledDate || null,
    breakdownAt: fromLocalInput(form.breakdownAt),
    vendorId: form.vendorId || null,
    vendorCost: form.vendorCost || "0",
    laborCost: form.laborCost || "0",
    laborHours: form.laborHours || null,
    resolution: form.resolution || null,
    checklist: form.checklist,
    custom: form.custom,
  });

  async function run<T>(fn: () => Promise<T>, ok?: string) {
    setBusy(true);
    setErrors({});
    try {
      const r = await fn();
      if (ok) toast.success(ok);
      return r;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (isNew) {
      const r = await run(() => api<Detail>("/maintenance-requests", { method: "POST", body: body() }));
      if (r) router.replace(`/maintenance/requests/${r.id}`);
      return;
    }
    const r = await run(
      () => api<Detail>(`/maintenance-requests/${params.id}`, { method: "PUT", body: body() }),
      l("Tersimpan.", "Saved."),
    );
    if (r) fill(r);
  }

  async function saveParts() {
    const r = await run(
      () =>
        api<Detail>(`/maintenance-requests/${params.id}/parts`, {
          method: "PUT",
          body: {
            parts: parts
              .filter((p) => p.productId)
              .map((p) => ({
                productId: p.productId,
                quantity: p.quantity,
                locationId: p.locationId || null,
                lotName: p.lotName || null,
              })),
          },
        }),
      l("Suku cadang disimpan.", "Spare parts saved."),
    );
    if (r) fill(r);
  }

  async function action(name: "start" | "cancel" | "done" | "bill") {
    if (name === "cancel") {
      const ok = await ask({
        title: l("Batalkan permintaan?", "Cancel request?"),
        message: l("Permintaan ditandai batal.", "The request will be cancelled."),
        confirmLabel: l("Batalkan", "Cancel request"),
        danger: true,
      });
      if (!ok) return;
    }
    if (name === "done") {
      // Simpan isian (biaya, catatan, checklist) & suku cadang dulu agar ikut diproses.
      const saved = await run(() =>
        api<Detail>(`/maintenance-requests/${params.id}`, { method: "PUT", body: body() }),
      );
      if (!saved) return;
      const savedParts = await run(() =>
        api<Detail>(`/maintenance-requests/${params.id}/parts`, {
          method: "PUT",
          body: {
            parts: parts
              .filter((p) => p.productId)
              .map((p) => ({
                productId: p.productId,
                quantity: p.quantity,
                locationId: p.locationId || null,
                lotName: p.lotName || null,
              })),
          },
        }),
      );
      if (!savedParts) return;
    }
    const r = await run(
      () =>
        api<Detail | { moveId: string }>(`/maintenance-requests/${params.id}/${name}`, {
          method: "POST",
          body:
            name === "done"
              ? {
                  resolution: form.resolution || null,
                  laborHours: form.laborHours || null,
                  laborCost: form.laborCost || "0",
                  checklist: form.checklist,
                  meter: meter || null,
                }
              : {},
        }),
      name === "bill" ? l("Tagihan vendor dibuat (draft).", "Vendor bill created (draft).") : undefined,
    );
    if (r && "id" in r) fill(r as Detail);
    else if (r) load();
  }

  if (!isNew && !data)
    return loadError ? (
      <LoadFailed message={loadError} />
    ) : (
      <p className="muted">{l("Memuat…", "Loading…")}</p>
    );

  return (
    <>
      <header className="toolbar control-panel">
        <div className="cp-left">
          <nav className="breadcrumb">
            <Link href="/maintenance/requests">{l("Permintaan Perawatan", "Maintenance Requests")}</Link> /{" "}
            {data?.name ?? l("Baru", "New")}
          </nav>
          {data && <StateBadge state={data.state} />}
        </div>
        <div className="cp-right">
          {data && canWrite && (data.state === "new" || data.state === "scheduled") && (
            <button type="button" onClick={() => void action("start")} disabled={busy}>
              {l("Mulai kerjakan", "Start")}
            </button>
          )}
          {data && canWrite && (
            <button type="button" className="primary" onClick={() => void action("done")} disabled={busy}>
              {l("Selesai", "Mark done")}
            </button>
          )}
          {data && canWrite && (
            <button type="button" className="danger" onClick={() => void action("cancel")} disabled={busy}>
              {l("Batalkan", "Cancel")}
            </button>
          )}
          {(isNew || canWrite) && (
            <button
              type="button"
              className={data ? "" : "primary"}
              onClick={save}
              disabled={busy}
              aria-busy={busy}
            >
              {l("Simpan", "Save")}
            </button>
          )}
        </div>
      </header>

      <section className="panel">
        <div className="fields">
          <label className="field" data-field="equipmentId">
            <span>{l("Peralatan", "Equipment")} *</span>
            <select
              value={form.equipmentId}
              disabled={!isNew && !canWrite}
              onChange={(e) => set("equipmentId", e.target.value)}
            >
              <option value="">—</option>
              {equipment.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.code} — {e.name}
                </option>
              ))}
            </select>
            {err("equipmentId")}
          </label>
          <label className="field" data-field="title">
            <span>{l("Judul", "Title")} *</span>
            <input
              value={form.title}
              maxLength={200}
              disabled={!isNew && !canWrite}
              onChange={(e) => set("title", e.target.value)}
            />
            {err("title")}
          </label>
          <label className="field">
            <span>{l("Jenis", "Type")}</span>
            <select
              value={form.kind}
              disabled={!isNew && !canWrite}
              onChange={(e) => set("kind", e.target.value as "preventive" | "corrective")}
            >
              <option value="corrective">{l("Korektif (perbaikan)", "Corrective (repair)")}</option>
              <option value="preventive">{l("Preventif", "Preventive")}</option>
            </select>
          </label>
          <label className="field">
            <span>{l("Prioritas", "Priority")}</span>
            <select
              value={form.priority}
              disabled={!isNew && !canWrite}
              onChange={(e) => set("priority", e.target.value)}
            >
              {Object.keys(PRIORITY_LABEL).map((p) => (
                <option key={p} value={p}>
                  {priorityLabel(p, locale)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{l("Tanggal jadwal", "Scheduled date")}</span>
            <input
              type="date"
              value={form.scheduledDate}
              disabled={!isNew && !canWrite}
              onChange={(e) => set("scheduledDate", e.target.value)}
            />
          </label>
          {form.kind === "corrective" && (
            <label className="field" data-field="breakdownAt">
              <span>{l("Mulai rusak", "Breakdown since")}</span>
              <input
                type="datetime-local"
                value={form.breakdownAt}
                disabled={!isNew && !canWrite}
                onChange={(e) => set("breakdownAt", e.target.value)}
              />
            </label>
          )}
          <label className="field">
            <span>{l("Tim", "Team")}</span>
            <select
              value={form.teamId}
              disabled={!isNew && !canWrite}
              onChange={(e) => set("teamId", e.target.value)}
            >
              <option value="">—</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{l("Teknisi", "Technician")}</span>
            <select
              value={form.technicianUserId}
              disabled={!isNew && !canWrite}
              onChange={(e) => set("technicianUserId", e.target.value)}
            >
              <option value="">—</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field wide">
            <span>{l("Keterangan", "Description")}</span>
            <textarea
              rows={3}
              value={form.description}
              disabled={!isNew && !canWrite}
              onChange={(e) => set("description", e.target.value)}
            />
          </label>
        </div>
        <CustomFieldsSection
          bare
          model="maintenance_request"
          value={form.custom}
          onChange={(v) => set("custom", v)}
          editable={isNew || canWrite}
          recordId={data?.id}
          errors={errors}
        />
      </section>

      {data && (
        <>
          {form.checklist.length > 0 && (
            <section className="panel">
              <h2>{l("Checklist", "Checklist")}</h2>
              {form.checklist.map((c, idx) => (
                <label key={idx} className="field check">
                  <span>{c.label}</span>
                  <input
                    type="checkbox"
                    checked={c.done}
                    disabled={!canWrite}
                    onChange={(e) =>
                      set(
                        "checklist",
                        form.checklist.map((x, j) => (j === idx ? { ...x, done: e.target.checked } : x)),
                      )
                    }
                  />
                </label>
              ))}
            </section>
          )}

          <section className="panel">
            <h2>{l("Suku cadang", "Spare parts")}</h2>
            <p className="muted">
              {l(
                "Stok dikeluarkan saat permintaan diselesaikan dan dibebankan ke akun beban perawatan + cost center peralatan.",
                "Stock is issued when the request is done and expensed to the maintenance account + the equipment's cost center.",
              )}
            </p>
            {err("parts")}
            <div className="table-wrap">
              <table className="table compact">
                <thead>
                  <tr>
                    <th>{l("Produk", "Product")}</th>
                    <th>{l("Jumlah", "Quantity")}</th>
                    <th>{l("Lokasi", "Location")}</th>
                    <th>{l("Lot/serial", "Lot/serial")}</th>
                    <th>{l("Biaya", "Cost")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {parts.map((p, idx) => (
                    <tr key={idx}>
                      <td>
                        <select
                          aria-label={l("Produk", "Product")}
                          value={p.productId}
                          disabled={!canWrite}
                          onChange={(e) =>
                            setParts(
                              parts.map((x, j) => (j === idx ? { ...x, productId: e.target.value } : x)),
                            )
                          }
                        >
                          <option value="">—</option>
                          {products
                            .filter((x) => x.productType !== "service")
                            .map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.sku} — {x.name}
                              </option>
                            ))}
                        </select>
                        {err(`parts.${idx}.productId`)}
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          aria-label={l("Jumlah", "Quantity")}
                          value={p.quantity}
                          disabled={!canWrite}
                          onChange={(e) =>
                            setParts(
                              parts.map((x, j) => (j === idx ? { ...x, quantity: e.target.value } : x)),
                            )
                          }
                        />
                        {err(`parts.${idx}.quantity`)}
                      </td>
                      <td>
                        <select
                          aria-label={l("Lokasi", "Location")}
                          value={p.locationId ?? ""}
                          disabled={!canWrite}
                          onChange={(e) =>
                            setParts(
                              parts.map((x, j) =>
                                j === idx ? { ...x, locationId: e.target.value || null } : x,
                              ),
                            )
                          }
                        >
                          <option value="">{l("Bawaan", "Default")}</option>
                          {locations.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.completeName}
                            </option>
                          ))}
                        </select>
                        {err(`parts.${idx}.locationId`)}
                      </td>
                      <td>
                        <input
                          aria-label={l("Lot/serial", "Lot/serial")}
                          value={p.lotName ?? ""}
                          disabled={!canWrite}
                          onChange={(e) =>
                            setParts(
                              parts.map((x, j) =>
                                j === idx ? { ...x, lotName: e.target.value || null } : x,
                              ),
                            )
                          }
                        />
                        {err(`parts.${idx}.lotName`)}
                      </td>
                      <td>{p.cost ? money(p.cost, locale) : "—"}</td>
                      <td>
                        {canWrite && (
                          <button
                            type="button"
                            aria-label={l("Hapus baris", "Remove line")}
                            onClick={() => setParts(parts.filter((_, j) => j !== idx))}
                          >
                            ×
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {canWrite && (
              <div className="automation-row">
                <button
                  type="button"
                  onClick={() =>
                    setParts([...parts, { productId: "", quantity: "1", locationId: null, lotName: null }])
                  }
                >
                  {l("Tambah suku cadang", "Add spare part")}
                </button>
                <button type="button" onClick={saveParts} disabled={busy}>
                  {l("Simpan suku cadang", "Save spare parts")}
                </button>
              </div>
            )}
          </section>

          <section className="panel">
            <h2>{l("Pengerjaan & biaya", "Work & cost")}</h2>
            <div className="fields">
              <label className="field wide">
                <span>{l("Hasil / tindakan", "Resolution")}</span>
                <textarea
                  rows={2}
                  value={form.resolution}
                  disabled={!canWrite}
                  onChange={(e) => set("resolution", e.target.value)}
                />
              </label>
              <label className="field">
                <span>{l("Jam kerja", "Labour hours")}</span>
                <input
                  type="number"
                  min={0}
                  value={form.laborHours}
                  disabled={!canWrite}
                  onChange={(e) => set("laborHours", e.target.value)}
                />
              </label>
              <label className="field" data-field="laborCost">
                <span>{l("Biaya tenaga kerja internal", "Internal labour cost")}</span>
                <input
                  type="number"
                  min={0}
                  value={form.laborCost}
                  disabled={!canWrite}
                  onChange={(e) => set("laborCost", e.target.value)}
                />
              </label>
              <label className="field" data-field="vendorId">
                <span>{l("Vendor jasa", "Service vendor")}</span>
                <select
                  value={form.vendorId}
                  disabled={!canWrite || !!data.moveId}
                  onChange={(e) => set("vendorId", e.target.value)}
                >
                  <option value="">—</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
                {err("vendorId")}
              </label>
              <label className="field" data-field="vendorCost">
                <span>{l("Biaya jasa vendor", "Vendor service cost")}</span>
                <input
                  type="number"
                  min={0}
                  value={form.vendorCost}
                  disabled={!canWrite || !!data.moveId}
                  onChange={(e) => set("vendorCost", e.target.value)}
                />
                {err("vendorCost")}
              </label>
              {data.equipment.meterUnit && canWrite && (
                <label className="field">
                  <span>{l("Meter saat selesai", "Meter when done")}</span>
                  <input
                    type="number"
                    min={0}
                    placeholder={String(Number(data.equipment.meter))}
                    value={meter}
                    onChange={(e) => setMeter(e.target.value)}
                  />
                </label>
              )}
            </div>
            <dl className="totals">
              <dt>{l("Suku cadang", "Spare parts")}</dt>
              <dd>{money(data.partsCost, locale)}</dd>
              <dt>{l("Jasa vendor", "Vendor service")}</dt>
              <dd>{money(data.vendorCost, locale)}</dd>
              <dt>{l("Tenaga kerja", "Labour")}</dt>
              <dd>{money(data.laborCost, locale)}</dd>
              <dt>{l("Total", "Total")}</dt>
              <dd>
                <strong>{money(data.totalCost, locale)}</strong>
              </dd>
              {data.downtimeHours !== null && (
                <>
                  <dt>{l("Downtime", "Downtime")}</dt>
                  <dd>{l(`${Number(data.downtimeHours)} jam`, `${Number(data.downtimeHours)} hours`)}</dd>
                </>
              )}
            </dl>
            <div className="automation-row">
              {data.partsMoveId && (
                <Link href={`/accounting/moves/${data.partsMoveId}`}>
                  {l("Jurnal suku cadang", "Spare parts entry")}
                </Link>
              )}
              {data.moveId ? (
                <Link href={`/accounting/moves/${data.moveId}`}>
                  {l("Buka tagihan vendor", "Open vendor bill")}
                </Link>
              ) : (
                can(me.permissions, "maintenance.manage") &&
                can(me.permissions, "accounting.write") &&
                data.state !== "cancelled" &&
                data.vendorId &&
                Number(data.vendorCost) > 0 && (
                  <button type="button" onClick={() => void action("bill")} disabled={busy}>
                    {l("Buat tagihan vendor", "Create vendor bill")}
                  </button>
                )
              )}
              <Link href={`/equipment/${data.equipmentId}`}>
                {l("Buka peralatan", "Open equipment")} {data.equipment.code}
              </Link>
            </div>
          </section>
        </>
      )}
      {isNew && (
        <p className="muted">
          {l(
            "Simpan dulu, lalu tambahkan suku cadang dan biaya.",
            "Save first, then add spare parts and costs.",
          )}
        </p>
      )}
      {params.id && params.id !== "new" && <RelatedDocuments model="maintenance_request" id={params.id} />}
    </>
  );
}
