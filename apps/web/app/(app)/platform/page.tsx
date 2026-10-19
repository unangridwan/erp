"use client";

import { useCallback, useEffect, useState } from "react";
import { useMe } from "../../../components/me-context";
import { api } from "../../../lib/api";
import { formatDate, money } from "../../../lib/format";
import { useI18n } from "../../../lib/i18n";
import { SUBSCRIPTION_STATUS_LABEL } from "../../../lib/resources";

interface Tenant {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
  planCode: string | null;
  status: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
}

interface OpenInvoice {
  id: string;
  number: string;
  tenantSlug: string;
  planName: string;
  total: string;
  dueAt: string;
  provider: string | null;
}

const date = (v: string | null, locale: "id" | "en") => (v ? formatDate(v.slice(0, 10), locale) : "—");

/** Konsol operator SaaS: tenant, status langganan, konfirmasi transfer manual. */
export default function PlatformPage() {
  const me = useMe();
  const { l, tx, locale } = useI18n();
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [invoices, setInvoices] = useState<OpenInvoice[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([api<Tenant[]>("/platform/tenants"), api<OpenInvoice[]>("/platform/invoices")])
      .then(([t, i]) => {
        setTenants(t);
        setInvoices(i);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!me.platformAdmin)
    return <p className="error">{l("Khusus admin platform.", "Platform admins only.")}</p>;

  const extendTrial = (t: Tenant) => {
    const days = Number(
      window.prompt(l("Perpanjang uji coba berapa hari?", "Extend trial by how many days?"), "14"),
    );
    if (days > 0)
      void run(() =>
        api(`/platform/tenants/${t.id}/subscription`, {
          method: "PATCH",
          body: { status: "trialing", trialEndsAt: new Date(Date.now() + days * 86_400_000).toISOString() },
        }),
      );
  };

  return (
    <>
      <header className="toolbar">
        <h1>{l("Admin Platform", "Platform Admin")}</h1>
        <button onClick={() => run(() => api("/platform/billing/run", { method: "POST" }))}>
          {l("Buat tagihan perpanjangan", "Generate renewal invoices")}
        </button>
      </header>
      {error && <p className="error">{error}</p>}
      <h2>{l("Tagihan menunggu pembayaran", "Invoices awaiting payment")}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{l("Nomor", "Number")}</th>
              <th>Tenant</th>
              <th>{l("Paket", "Plan")}</th>
              <th>{l("Jatuh tempo", "Due")}</th>
              <th className="num">Total</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {invoices.map((i) => (
              <tr key={i.id}>
                <td>{i.number}</td>
                <td>{i.tenantSlug}</td>
                <td>{i.planName}</td>
                <td>{date(i.dueAt, locale)}</td>
                <td className="num">{money(i.total, locale)}</td>
                <td>
                  <button
                    className="link"
                    onClick={() => {
                      if (window.confirm(l(`Tandai ${i.number} lunas?`, `Mark ${i.number} as paid?`)))
                        void run(() =>
                          api(`/platform/invoices/${i.id}/mark-paid`, { method: "POST", body: {} }),
                        );
                    }}
                  >
                    {l("Tandai lunas", "Mark paid")}
                  </button>
                </td>
              </tr>
            ))}
            {invoices.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  {l("Tidak ada tagihan terbuka.", "No open invoices.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <h2>Tenant</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Slug</th>
              <th>{l("Nama", "Name")}</th>
              <th>{l("Paket", "Plan")}</th>
              <th>{l("Status", "Status")}</th>
              <th>{l("Berakhir", "Ends")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(tenants ?? []).map((t) => (
              <tr key={t.id}>
                <td>{t.slug}</td>
                <td>{t.name}</td>
                <td>{t.planCode ?? "—"}</td>
                <td>{t.status ? tx(SUBSCRIPTION_STATUS_LABEL[t.status]!) : "—"}</td>
                <td>{date(t.status === "trialing" ? t.trialEndsAt : t.currentPeriodEnd, locale)}</td>
                <td className="actions">
                  <button className="link" onClick={() => extendTrial(t)}>
                    {l("Perpanjang uji coba", "Extend trial")}
                  </button>
                  {t.status === "suspended" ? (
                    <button
                      className="link"
                      onClick={() =>
                        run(() =>
                          api(`/platform/tenants/${t.id}/subscription`, {
                            method: "PATCH",
                            body: { status: "active" },
                          }),
                        )
                      }
                    >
                      {l("Aktifkan", "Reactivate")}
                    </button>
                  ) : (
                    <button
                      className="link danger"
                      onClick={() => {
                        if (window.confirm(l(`Tangguhkan ${t.slug}?`, `Suspend ${t.slug}?`)))
                          void run(() =>
                            api(`/platform/tenants/${t.id}/subscription`, {
                              method: "PATCH",
                              body: { status: "suspended" },
                            }),
                          );
                      }}
                    >
                      {l("Tangguhkan", "Suspend")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
