"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useOptions } from "../../../../../components/accounting/use-options";
import { toast } from "../../../../../components/feedback";
import { useMe } from "../../../../../components/me-context";
import { QualityBadge } from "../../../../../components/quality/quality-ui";
import { api, ApiError } from "../../../../../lib/api";
import { useI18n } from "../../../../../lib/i18n";
import { can } from "../../../../../lib/resources";

interface Form {
  title: string;
  description: string;
  rootCause: string;
  correctiveAction: string;
  responsibleUserId: string;
  productId: string;
  partnerId: string;
  state: "open" | "in_progress" | "closed";
}
const EMPTY: Form = {
  title: "",
  description: "",
  rootCause: "",
  correctiveAction: "",
  responsibleUserId: "",
  productId: "",
  partnerId: "",
  state: "open",
};

/** NCR: masalah, akar masalah, tindakan perbaikan, penanggung jawab, status. */
export default function QualityAlertPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { l } = useI18n();
  const me = useMe();
  const isNew = id === "new";
  const [f, setF] = useState<Form | null>(isNew ? EMPTY : null);
  const [meta, setMeta] = useState<{ name: string; check: { id: string; name: string } | null } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const users = useOptions<{ id: string; name: string }>("/users/options");
  const products = useOptions<{ id: string; sku: string; name: string }>("/products");
  const partners = useOptions<{ id: string; name: string }>("/partners");
  const editable = can(me.permissions, "quality.write");

  useEffect(() => {
    if (isNew) return;
    api<Record<string, string | null> & { name: string; check: { id: string; name: string } | null }>(
      `/quality-alerts/${id}`,
    ).then(
      (a) => {
        setMeta({ name: a.name, check: a.check });
        setF({
          title: a.title ?? "",
          description: a.description ?? "",
          rootCause: a.rootCause ?? "",
          correctiveAction: a.correctiveAction ?? "",
          responsibleUserId: a.responsibleUserId ?? "",
          productId: a.productId ?? "",
          partnerId: a.partnerId ?? "",
          state: (a.state as Form["state"]) ?? "open",
        });
      },
      (e: Error) => toast.error(e.message),
    );
  }, [id, isNew]);
  if (!f) return <p className="muted">{l("Memuat…", "Loading…")}</p>;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF({ ...f, [k]: v });
  const err = (k: string) => (errors[k] ? <small className="error">{errors[k]}</small> : null);

  async function save(state = f!.state) {
    setBusy(true);
    setErrors({});
    const body = {
      ...f,
      state,
      responsibleUserId: f!.responsibleUserId || null,
      productId: f!.productId || null,
      partnerId: f!.partnerId || null,
    };
    try {
      const r = await api<{ id: string }>(isNew ? "/quality-alerts" : `/quality-alerts/${id}`, {
        method: isNew ? "POST" : "PUT",
        body,
      });
      toast.success(l("NCR disimpan.", "NCR saved."));
      setF({ ...f!, state });
      if (isNew) router.replace(`/quality/alerts/${r.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      if (e instanceof ApiError) setErrors(e.fieldErrors);
    } finally {
      setBusy(false);
    }
  }

  const area = (k: "description" | "rootCause" | "correctiveAction", label: string) => (
    <label className="field wide" data-field={k}>
      <span>{label}</span>
      <textarea rows={3} value={f[k]} disabled={!editable} onChange={(e) => set(k, e.target.value)} />
      {err(k)}
    </label>
  );

  return (
    <>
      <header className="toolbar control-panel">
        <div className="cp-left">
          <nav className="breadcrumb">
            <Link href="/quality/alerts">{l("Ketidaksesuaian (NCR)", "Non-conformances (NCR)")}</Link> /{" "}
            {meta?.name ?? l("Baru", "New")}
          </nav>
          {!isNew && <QualityBadge state={f.state} />}
        </div>
        {editable && (
          <div className="cp-right">
            {!isNew && f.state !== "closed" && (
              <button type="button" onClick={() => void save("closed")} disabled={busy}>
                {l("Tutup NCR", "Close NCR")}
              </button>
            )}
            <button
              type="button"
              className="primary"
              onClick={() => void save()}
              disabled={busy}
              aria-busy={busy}
            >
              {l("Simpan", "Save")}
            </button>
          </div>
        )}
      </header>
      <section className="panel">
        <div className="fields">
          <label className="field" data-field="title">
            <span>{l("Judul", "Title")} *</span>
            <input
              value={f.title}
              maxLength={200}
              disabled={!editable}
              onChange={(e) => set("title", e.target.value)}
            />
            {err("title")}
          </label>
          <label className="field">
            <span>{l("Status", "Status")}</span>
            <select
              value={f.state}
              disabled={!editable}
              onChange={(e) => set("state", e.target.value as Form["state"])}
            >
              <option value="open">{l("Terbuka", "Open")}</option>
              <option value="in_progress">{l("Ditangani", "In progress")}</option>
              <option value="closed">{l("Ditutup", "Closed")}</option>
            </select>
          </label>
          <label className="field">
            <span>{l("Penanggung jawab", "Responsible")}</span>
            <select
              value={f.responsibleUserId}
              disabled={!editable}
              onChange={(e) => set("responsibleUserId", e.target.value)}
            >
              <option value="">—</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{l("Produk", "Product")}</span>
            <select
              value={f.productId}
              disabled={!editable}
              onChange={(e) => set("productId", e.target.value)}
            >
              <option value="">—</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} — {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{l("Pemasok", "Supplier")}</span>
            <select
              value={f.partnerId}
              disabled={!editable}
              onChange={(e) => set("partnerId", e.target.value)}
            >
              <option value="">—</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {meta?.check && (
            <div className="field">
              <span>{l("Pemeriksaan", "Quality check")}</span>
              <Link href={`/quality/checks/${meta.check.id}`}>{meta.check.name}</Link>
            </div>
          )}
          {area("description", l("Uraian masalah", "Problem description"))}
          {area("rootCause", l("Akar masalah", "Root cause"))}
          {area("correctiveAction", l("Tindakan perbaikan & pencegahan", "Corrective & preventive action"))}
        </div>
      </section>
    </>
  );
}
