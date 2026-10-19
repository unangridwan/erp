"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { formatDate, money } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { can } from "../lib/resources";
import { useMe } from "./me-context";

interface Attribute {
  id: string;
  name: string;
}
interface AttributeValue {
  id: string;
  attributeId: string;
  name: string;
  priceExtra: string;
}
interface Variant {
  id: string;
  sku: string;
  name: string;
  salePrice: string;
  active: boolean;
  attributes: { attribute: string; value: string }[];
}

/** Varian produk: daftar varian & pembuat kombinasi dari nilai atribut. */
function VariantsPanel({ id }: { id: string }) {
  const me = useMe();
  const { l, locale } = useI18n();
  const [data, setData] = useState<{ template: { variantOfId: string | null }; variants: Variant[] } | null>(
    null,
  );
  const [attributes, setAttributes] = useState<Attribute[]>([]);
  const [values, setValues] = useState<AttributeValue[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<typeof data>(`/products/${id}/variants`)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);
  useEffect(() => {
    api<{ items: Attribute[] }>("/product-attributes?limit=200").then((r) => setAttributes(r.items));
    api<{ items: AttributeValue[] }>("/product-attribute-values?limit=200").then((r) => setValues(r.items));
  }, []);

  if (!data || data.template.variantOfId) return null;
  const writable = can(me.permissions, "product.write");
  const groups = attributes
    .map((a) => values.filter((v) => v.attributeId === a.id && picked.has(v.id)).map((v) => v.id))
    .filter((g) => g.length);
  const count = groups.reduce((n, g) => n * g.length, groups.length ? 1 : 0);

  return (
    <section className="panel">
      <h2>{l("Varian", "Variants")}</h2>
      {error && <p className="error">{error}</p>}
      {data.variants.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>{l("Atribut", "Attributes")}</th>
                <th className="num">{l("Harga jual", "Sales price")}</th>
              </tr>
            </thead>
            <tbody>
              {data.variants.map((v) => (
                <tr key={v.id} className={v.active ? "" : "muted"}>
                  <td>
                    <Link href={`/products/${v.id}`}>{v.sku}</Link>
                  </td>
                  <td>{v.attributes.map((a) => `${a.attribute}: ${a.value}`).join(" · ")}</td>
                  <td className="num">{money(v.salePrice, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">
          {l(
            "Belum ada varian. Pilih nilai atribut untuk membuat setiap kombinasinya sebagai produk tersendiri (stok & SKU sendiri); produk ini menjadi induknya.",
            "No variants yet. Pick attribute values to create every combination as its own product (own stock & SKU); this product becomes the parent.",
          )}
        </p>
      )}
      {writable && (
        <div className="variant-picker">
          {attributes.length === 0 && (
            <p className="muted">
              {l("Buat atribut dulu di", "Create attributes first in")}{" "}
              <Link href="/product-attributes">{l("Atribut Produk", "Product Attributes")}</Link>.
            </p>
          )}
          {attributes.map((a) => (
            <fieldset key={a.id}>
              <legend>{a.name}</legend>
              {values
                .filter((v) => v.attributeId === a.id)
                .map((v) => (
                  <label key={v.id} className="inline-check">
                    <input
                      type="checkbox"
                      checked={picked.has(v.id)}
                      onChange={(e) =>
                        setPicked((s) => {
                          const next = new Set(s);
                          if (e.target.checked) next.add(v.id);
                          else next.delete(v.id);
                          return next;
                        })
                      }
                    />
                    {v.name}
                    {Number(v.priceExtra) ? ` (+${money(v.priceExtra, locale)})` : ""}
                  </label>
                ))}
            </fieldset>
          ))}
          {attributes.length > 0 && (
            <button
              type="button"
              className="primary"
              disabled={busy || !count}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await api(`/products/${id}/variants`, { method: "POST", body: { values: groups } });
                  setPicked(new Set());
                  load();
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {l(`Buat ${count} kombinasi`, `Create ${count} combinations`)}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

interface PortalAccess {
  email: string;
  name: string;
  active: boolean;
  hasPassword: boolean;
  invitePending: boolean;
  inviteExpiresAt: string | null;
  lastLoginAt: string | null;
  inviteUrl?: string;
}

/** Akses portal pelanggan: undang/undang ulang & cabut. */
function PortalAccessPanel({ id }: { id: string }) {
  const me = useMe();
  const { l, locale } = useI18n();
  const [access, setAccess] = useState<PortalAccess | null | undefined>(undefined);
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<PortalAccess | null>(`/partners/${id}/portal`)
      .then((a) => {
        // Belum ada akses: API membalas null (badan kosong).
        const found = a && a.email ? a : null;
        setAccess(found);
        setEmail(found?.email ?? "");
      })
      .catch(() => setAccess(null));
  }, [id]);

  if (access === undefined) return null;
  const writable = can(me.permissions, "partner.write");
  const run = async (path: string, body?: object) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<PortalAccess>(`/partners/${id}/${path}`, { method: "POST", body: body ?? {} });
      setAccess(res);
      setLink(res.inviteUrl ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <h2>{l("Portal pelanggan", "Customer portal")}</h2>
      {error && <p className="error">{error}</p>}
      {access ? (
        <p>
          {access.name} &lt;{access.email}&gt; ·{" "}
          {!access.active
            ? l("dicabut", "revoked")
            : access.hasPassword
              ? l("aktif", "active")
              : l("menunggu undangan diterima", "invitation pending")}
          {access.lastLoginAt && (
            <span className="muted">
              {" "}
              · {l("terakhir masuk", "last login")} {formatDate(access.lastLoginAt.slice(0, 10), locale)}
            </span>
          )}
        </p>
      ) : (
        <p className="muted">
          {l(
            "Pelanggan bisa melihat penawaran, pesanan, dan faktur, mengunduh PDF, serta menyetujui penawaran lewat portal.",
            "Customers can view quotations, orders and invoices, download PDFs, and accept quotations in the portal.",
          )}
        </p>
      )}
      {writable && (
        <div className="cp-right">
          <input
            type="email"
            placeholder={l("Email portal", "Portal email")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button type="button" disabled={busy} onClick={() => run("portal-invite", email ? { email } : {})}>
            {access
              ? l("Kirim ulang undangan", "Resend invitation")
              : l("Undang ke portal", "Invite to portal")}
          </button>
          {access?.active && (
            <button type="button" className="danger" disabled={busy} onClick={() => run("portal-revoke")}>
              {l("Cabut akses", "Revoke")}
            </button>
          )}
        </div>
      )}
      {link && (
        <p className="notice">
          {l(
            "Undangan terkirim. Tautan (bisa dibagikan manual):",
            "Invitation sent. Link (can be shared manually):",
          )}{" "}
          <code className="wrap">{link}</code>
        </p>
      )}
    </section>
  );
}

/** Panel tambahan di bawah form generik untuk resource tertentu. */
export function FormExtras({ path, id }: { path: string; id: string }) {
  if (path === "products") return <VariantsPanel id={id} />;
  if (path === "partners") return <PortalAccessPanel id={id} />;
  return null;
}
