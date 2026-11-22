"use client";

import { CONTACT_ROLE_LABEL, CONTACT_ROLE_VALUES, leadProductSubtotal, leadProductsTotal } from "@erp/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { formatDate, money } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { LEAD_STATE_LABEL } from "../../lib/resources";
import { useOptions } from "../accounting/use-options";
import { ask, toast } from "../feedback";

export interface LeadProduct {
  productId: string;
  productName?: string;
  name: string | null;
  quantity: string;
  priceUnit: string;
  discount: string;
  subtotal?: string;
}
export interface LeadContactRole {
  partnerId: string;
  name?: string;
  email?: string | null;
  phone?: string | null;
  jobTitle?: string | null;
  role: string;
  isPrimary: boolean;
  note: string | null;
}
export interface StageHistoryRow {
  id: string;
  fromStageName: string | null;
  toStageName: string | null;
  state: string;
  expectedRevenue: string;
  userName: string | null;
  changedAt: string;
}

const trim = (v: string) => String(Number(v));
const safe = (fn: () => string) => {
  try {
    return fn();
  } catch {
    return "0.00";
  }
};

/** Produk yang ditawarkan pada peluang; total menjadi pendapatan harapan. */
export function ProductsPanel(props: {
  leadId: string;
  products: LeadProduct[];
  editable: boolean;
  onSaved: () => void;
}) {
  const { l, locale } = useI18n();
  const catalog = useOptions<{ id: string; name: string; salePrice: string }>("/products");
  const [lines, setLines] = useState<LeadProduct[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLines(
      props.products.map((p) => ({
        ...p,
        quantity: trim(p.quantity),
        priceUnit: trim(p.priceUnit),
        discount: trim(p.discount),
      })),
    );
    setDirty(false);
  }, [props.products]);

  const patch = (i: number, values: Partial<LeadProduct>) => {
    setLines((rows) => rows.map((r, j) => (j === i ? { ...r, ...values } : r)));
    setDirty(true);
  };
  const valid = lines.filter((r) => r.productId && Number(r.quantity) > 0);
  const total = safe(() =>
    leadProductsTotal(
      valid.map((r) => ({
        quantity: r.quantity,
        priceUnit: r.priceUnit || "0",
        discount: r.discount || "0",
      })),
    ),
  );

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/leads/${props.leadId}/products`, {
        method: "PUT",
        body: {
          lines: valid.map((r) => ({
            productId: r.productId,
            name: r.name || null,
            quantity: r.quantity,
            priceUnit: r.priceUnit === "" ? null : r.priceUnit,
            discount: r.discount || "0",
          })),
        },
      });
      toast.success(l("Produk tersimpan", "Products saved"));
      props.onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <header className="toolbar">
        <h2>{l("Produk", "Products")}</h2>
        {props.editable && (
          <>
            <button
              type="button"
              onClick={() => {
                setLines((rows) => [
                  ...rows,
                  { productId: "", name: null, quantity: "1", priceUnit: "", discount: "0" },
                ]);
                setDirty(true);
              }}
            >
              {l("Tambah baris", "Add line")}
            </button>
            {dirty && (
              <button type="button" className="primary" disabled={busy} onClick={save}>
                {l("Simpan produk", "Save products")}
              </button>
            )}
          </>
        )}
      </header>
      {error && <p className="error">{error}</p>}
      {lines.length === 0 ? (
        <p className="muted">
          {l(
            "Belum ada produk. Tambahkan produk agar nilai peluang dihitung otomatis dan penawaran bisa dibuat sekali klik.",
            "No products yet. Add products so the opportunity value is computed and a quotation can be created in one click.",
          )}
        </p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{l("Produk", "Product")}</th>
                <th className="num">{l("Qty", "Qty")}</th>
                <th className="num">{l("Harga", "Price")}</th>
                <th className="num">{l("Diskon %", "Discount %")}</th>
                <th className="num">{l("Subtotal", "Subtotal")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((r, i) => (
                <tr key={i}>
                  <td>
                    <select
                      aria-label={l("Produk", "Product")}
                      value={r.productId}
                      disabled={!props.editable}
                      onChange={(e) => {
                        const product = catalog.find((p) => p.id === e.target.value);
                        patch(i, {
                          productId: e.target.value,
                          priceUnit: product ? trim(product.salePrice) : "",
                        });
                      }}
                    >
                      <option value="">—</option>
                      {catalog.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                      {r.productId && !catalog.some((p) => p.id === r.productId) && (
                        <option value={r.productId}>{r.productName ?? r.productId}</option>
                      )}
                    </select>
                  </td>
                  {(["quantity", "priceUnit", "discount"] as const).map((f) => (
                    <td key={f} className="num">
                      <input
                        className="num"
                        inputMode="decimal"
                        aria-label={f}
                        style={{ width: f === "priceUnit" ? 130 : 80 }}
                        value={r[f]}
                        disabled={!props.editable}
                        onChange={(e) => patch(i, { [f]: e.target.value })}
                      />
                    </td>
                  ))}
                  <td className="num">
                    {money(
                      safe(() =>
                        leadProductSubtotal({
                          quantity: r.quantity || "0",
                          priceUnit: r.priceUnit || "0",
                          discount: r.discount || "0",
                        }),
                      ),
                      locale,
                    )}
                  </td>
                  <td>
                    {props.editable && (
                      <button
                        type="button"
                        className="link"
                        onClick={() => {
                          setLines((rows) => rows.filter((_, j) => j !== i));
                          setDirty(true);
                        }}
                      >
                        {l("Hapus", "Remove")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={4}>{l("Total (pendapatan harapan)", "Total (expected revenue)")}</th>
                <th className="num">{money(total, locale)}</th>
                <th />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

/** Kontak yang terlibat pada peluang beserta perannya. */
export function ContactRolesPanel(props: {
  leadId: string;
  accountId: string | null;
  roles: LeadContactRole[];
  editable: boolean;
  onSaved: () => void;
}) {
  const { l } = useI18n();
  const people = useOptions<{ id: string; name: string; parentId: string | null; kind: string }>("/partners");
  const [rows, setRows] = useState<LeadContactRole[]>(props.roles);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(props.roles);
    setDirty(false);
  }, [props.roles]);

  // Kontak akun ini lebih dulu, lalu perorangan lain.
  const options = people
    .filter((p) => p.kind === "person" || p.id === props.accountId)
    .sort((a, b) => Number(b.parentId === props.accountId) - Number(a.parentId === props.accountId));
  const patch = (i: number, values: Partial<LeadContactRole>) => {
    setRows((list) =>
      list.map((r, j) => (j === i ? { ...r, ...values } : values.isPrimary ? { ...r, isPrimary: false } : r)),
    );
    setDirty(true);
  };

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/leads/${props.leadId}/contact-roles`, {
        method: "PUT",
        body: {
          roles: rows
            .filter((r) => r.partnerId)
            .map((r) => ({
              partnerId: r.partnerId,
              role: r.role,
              isPrimary: r.isPrimary,
              note: r.note || null,
            })),
        },
      });
      toast.success(l("Peran kontak tersimpan", "Contact roles saved"));
      props.onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <header className="toolbar">
        <h2>{l("Peran kontak", "Contact roles")}</h2>
        {props.editable && (
          <>
            <button
              type="button"
              onClick={() => {
                setRows((list) => [
                  ...list,
                  { partnerId: "", role: "other", isPrimary: list.length === 0, note: null },
                ]);
                setDirty(true);
              }}
            >
              {l("Tambah kontak", "Add contact")}
            </button>
            {dirty && (
              <button type="button" className="primary" disabled={busy} onClick={save}>
                {l("Simpan peran", "Save roles")}
              </button>
            )}
          </>
        )}
      </header>
      {error && <p className="error">{error}</p>}
      {rows.length === 0 ? (
        <p className="muted">
          {l(
            "Catat siapa pengambil keputusan, pemberi pengaruh, dan pengguna di pihak pelanggan.",
            "Record the decision maker, influencers and users on the customer side.",
          )}
        </p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{l("Kontak", "Contact")}</th>
                <th>{l("Peran", "Role")}</th>
                <th>{l("Utama", "Primary")}</th>
                <th>{l("Catatan", "Note")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <select
                      aria-label={l("Kontak", "Contact")}
                      value={r.partnerId}
                      disabled={!props.editable}
                      onChange={(e) => patch(i, { partnerId: e.target.value })}
                    >
                      <option value="">—</option>
                      {options.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                      {r.partnerId && !options.some((p) => p.id === r.partnerId) && (
                        <option value={r.partnerId}>{r.name ?? r.partnerId}</option>
                      )}
                    </select>
                    {r.jobTitle && <small className="muted"> {r.jobTitle}</small>}
                  </td>
                  <td>
                    <select
                      aria-label={l("Peran", "Role")}
                      value={r.role}
                      disabled={!props.editable}
                      onChange={(e) => patch(i, { role: e.target.value })}
                    >
                      {CONTACT_ROLE_VALUES.map((v) => (
                        <option key={v} value={v}>
                          {l(...CONTACT_ROLE_LABEL[v]!)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="radio"
                      name="primaryContact"
                      aria-label={l("Kontak utama", "Primary contact")}
                      checked={r.isPrimary}
                      disabled={!props.editable}
                      onChange={() => patch(i, { isPrimary: true })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={l("Catatan", "Note")}
                      value={r.note ?? ""}
                      disabled={!props.editable}
                      onChange={(e) => patch(i, { note: e.target.value })}
                    />
                  </td>
                  <td>
                    {props.editable && (
                      <button
                        type="button"
                        className="link"
                        onClick={() => {
                          setRows((list) => list.filter((_, j) => j !== i));
                          setDirty(true);
                        }}
                      >
                        {l("Hapus", "Remove")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Riwayat perpindahan tahap dan lama di tiap tahap. */
export function StageHistoryPanel(props: {
  history: StageHistoryRow[];
  stageDays: { stageId: string; stageName: string; days: number }[];
}) {
  const { l, tx, locale } = useI18n();
  if (props.history.length === 0) return null;
  return (
    <section className="panel">
      <h2>{l("Riwayat tahap", "Stage history")}</h2>
      {props.stageDays.length > 0 && (
        <p className="filters">
          {props.stageDays.map((d) => (
            <span key={d.stageId} className="badge">
              {d.stageName}: {d.days.toLocaleString(locale)} {l("hari", "days")}
            </span>
          ))}
        </p>
      )}
      <div className="table-scroll">
        <table>
          <tbody>
            {props.history.map((h) => (
              <tr key={h.id}>
                <td>{formatDate(h.changedAt, locale)}</td>
                <td>
                  {h.fromStageName && h.fromStageName !== h.toStageName ? `${h.fromStageName} → ` : ""}
                  {h.toStageName ?? "—"}
                  {h.state !== "open" && (
                    <span className={`badge state-${h.state}`}>{tx(LEAD_STATE_LABEL[h.state]!)}</span>
                  )}
                </td>
                <td className="num">{money(h.expectedRevenue, locale)}</td>
                <td>{h.userName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface Duplicates {
  leads: {
    id: string;
    name: string;
    leadType: string;
    partnerName: string | null;
    email: string | null;
    phone: string | null;
    userName: string | null;
    reasons: string[];
    accessible: boolean;
  }[];
  partners: {
    id: string;
    name: string;
    kind: string;
    email: string | null;
    phone: string | null;
    reasons: string[];
  }[];
}

/** Peringatan kemungkinan duplikat (lead lain atau partner yang sudah ada) dengan aksi gabung/tautkan. */
export function DuplicatesPanel(props: {
  leadId: string;
  version: number;
  editable: boolean;
  onChanged: () => void;
  onLinkPartner?: (partnerId: string) => void;
}) {
  const { l } = useI18n();
  const [data, setData] = useState<Duplicates | null>(null);

  useEffect(() => {
    api<Duplicates>(`/leads/${props.leadId}/duplicates`)
      .then(setData)
      .catch(() => setData(null));
  }, [props.leadId, props.version]);

  if (!data || (data.leads.length === 0 && data.partners.length === 0)) return null;
  const reason = (r: string) =>
    r === "email"
      ? l("email sama", "same email")
      : r === "phone"
        ? l("telepon sama", "same phone")
        : l("nama perusahaan sama", "same company name");

  async function merge(sourceId: string, name: string) {
    if (
      !(await ask(
        l(
          `Gabungkan "${name}" ke lead ini? Lead itu akan dihapus setelah datanya dipindahkan.`,
          `Merge "${name}" into this lead? That lead is deleted after its data is moved.`,
        ),
      ))
    )
      return;
    try {
      await api(`/leads/${props.leadId}/merge`, { method: "POST", body: { sourceIds: [sourceId] } });
      toast.success(l("Lead digabung", "Leads merged"));
      props.onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="notice">
      <strong>{l("Kemungkinan duplikat", "Possible duplicates")}</strong>
      <ul className="plain-list">
        {data.leads.map((d) => (
          <li key={d.id}>
            {d.leadType === "lead" ? l("Lead", "Lead") : l("Peluang", "Opportunity")}:{" "}
            {d.accessible ? <Link href={`/crm/leads/${d.id}`}>{d.name}</Link> : d.name}
            {d.userName ? ` (${d.userName})` : ""} — {d.reasons.map(reason).join(", ")}{" "}
            {props.editable && d.accessible && (
              <button type="button" className="link" onClick={() => merge(d.id, d.name)}>
                {l("Gabungkan ke sini", "Merge into this one")}
              </button>
            )}
          </li>
        ))}
        {data.partners.map((d) => (
          <li key={d.id}>
            {d.kind === "company" ? l("Akun", "Account") : l("Kontak", "Contact")}:{" "}
            <Link href={`/crm/accounts/${d.id}`}>{d.name}</Link> — {d.reasons.map(reason).join(", ")}{" "}
            {props.editable && props.onLinkPartner && (
              <button type="button" className="link" onClick={() => props.onLinkPartner!(d.id)}>
                {l("Pakai sebagai pelanggan", "Use as customer")}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
