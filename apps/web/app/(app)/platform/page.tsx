"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useMe } from "../../../components/me-context";
import { api, ApiError } from "../../../lib/api";
import { formatDate, money } from "../../../lib/format";
import { useI18n } from "../../../lib/i18n";
import { SUBSCRIPTION_STATUS_LABEL } from "../../../lib/resources";

interface Tenant {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
  planCode: string | null;
  planName: string | null;
  status: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  complimentary: boolean;
  complimentaryUntil: string | null;
  complimentaryNote: string | null;
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

interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceMonthly: string;
  priceYearly: string;
  maxUsers: number | null;
  maxCompanies: number | null;
  modules: string[];
  public: boolean;
  sort: number;
  active: boolean;
  tenantCount: number;
}

interface PlanForm {
  id: string | null;
  code: string;
  name: string;
  description: string;
  priceMonthly: string;
  priceYearly: string;
  maxUsers: string;
  maxCompanies: string;
  modules: string[];
  public: boolean;
  sort: string;
  active: boolean;
}

interface FreeForm {
  tenant: Tenant;
  planCode: string;
  until: string;
  note: string;
}

const MODULES: [string, string, string][] = [
  ["accounting", "Akuntansi", "Accounting"],
  ["crm", "CRM", "CRM"],
  ["sales", "Penjualan", "Sales"],
  ["purchase", "Pembelian", "Purchasing"],
  ["inventory", "Persediaan", "Inventory"],
  ["tax", "Pajak Coretax", "Coretax tax"],
  ["hr", "SDM", "HR"],
  ["payroll", "Payroll", "Payroll"],
  ["consolidation", "Konsolidasi", "Consolidation"],
];

const EMPTY_PLAN: PlanForm = {
  id: null,
  code: "",
  name: "",
  description: "",
  priceMonthly: "0",
  priceYearly: "0",
  maxUsers: "",
  maxCompanies: "",
  modules: MODULES.map(([k]) => k),
  public: true,
  sort: "0",
  active: true,
};

type Tab = "tenants" | "plans" | "invoices";

const date = (v: string | null, locale: "id" | "en") => (v ? formatDate(v.slice(0, 10), locale) : "—");

/** Konsol operator SaaS: tenant (paket, gratis, uji coba, tangguhkan), paket langganan, tagihan transfer manual. */
export default function PlatformPage() {
  const me = useMe();
  const { l, tx, locale } = useI18n();
  const [tab, setTab] = useState<Tab>("tenants");
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [invoices, setInvoices] = useState<OpenInvoice[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planForm, setPlanForm] = useState<PlanForm | null>(null);
  const [freeForm, setFreeForm] = useState<FreeForm | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(() => {
    Promise.all([
      api<Tenant[]>("/platform/tenants"),
      api<OpenInvoice[]>("/platform/invoices"),
      api<Plan[]>("/platform/plans"),
    ])
      .then(([t, i, p]) => {
        setTenants(t);
        setInvoices(i);
        setPlans(p);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function run(action: () => Promise<unknown>, done?: string) {
    setError(null);
    setErrors({});
    setNotice(null);
    try {
      await action();
      if (done) setNotice(done);
      load();
      return true;
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  if (!me.platformAdmin)
    return <p className="error">{l("Khusus admin platform.", "Platform admins only.")}</p>;

  const patch = (t: Tenant, body: object, done?: string) =>
    run(() => api(`/platform/tenants/${t.id}/subscription`, { method: "PATCH", body }), done);

  const extendTrial = (t: Tenant) => {
    const days = Number(
      window.prompt(l("Perpanjang uji coba berapa hari?", "Extend trial by how many days?"), "14"),
    );
    if (days > 0)
      void patch(t, {
        status: "trialing",
        trialEndsAt: new Date(Date.now() + days * 86_400_000).toISOString(),
      });
  };

  async function saveFree(e: FormEvent) {
    e.preventDefault();
    if (!freeForm) return;
    const ok = await patch(
      freeForm.tenant,
      {
        planCode: freeForm.planCode || undefined,
        complimentary: true,
        complimentaryUntil: freeForm.until ? new Date(`${freeForm.until}T23:59:59`).toISOString() : null,
        complimentaryNote: freeForm.note || null,
      },
      l(`${freeForm.tenant.slug} kini gratis.`, `${freeForm.tenant.slug} is now complimentary.`),
    );
    if (ok) setFreeForm(null);
  }

  async function savePlan(e: FormEvent) {
    e.preventDefault();
    if (!planForm) return;
    const body = {
      code: planForm.code,
      name: planForm.name,
      description: planForm.description || null,
      priceMonthly: planForm.priceMonthly || "0",
      priceYearly: planForm.priceYearly || "0",
      maxUsers: planForm.maxUsers ? Number(planForm.maxUsers) : null,
      maxCompanies: planForm.maxCompanies ? Number(planForm.maxCompanies) : null,
      modules: planForm.modules,
      public: planForm.public,
      sort: Number(planForm.sort || 0),
      active: planForm.active,
    };
    const ok = await run(
      () =>
        planForm.id
          ? api(`/platform/plans/${planForm.id}`, { method: "PUT", body })
          : api("/platform/plans", { method: "POST", body }),
      l("Paket disimpan.", "Plan saved."),
    );
    if (ok) setPlanForm(null);
  }

  const editPlan = (p: Plan) =>
    setPlanForm({
      id: p.id,
      code: p.code,
      name: p.name,
      description: p.description ?? "",
      priceMonthly: String(Number(p.priceMonthly)),
      priceYearly: String(Number(p.priceYearly)),
      maxUsers: p.maxUsers === null ? "" : String(p.maxUsers),
      maxCompanies: p.maxCompanies === null ? "" : String(p.maxCompanies),
      modules: p.modules,
      public: p.public,
      sort: String(p.sort),
      active: p.active,
    });
  const err = (k: string) => errors[k] && <small className="error">{errors[k]}</small>;
  const moduleLabel = (k: string) => {
    const m = MODULES.find(([key]) => key === k);
    return m ? l(m[1], m[2]) : k;
  };
  const limit = (n: number | null) => (n === null ? "∞" : String(n));

  return (
    <>
      <header className="toolbar">
        <h1>{l("Admin Platform", "Platform Admin")}</h1>
        <button
          onClick={() =>
            run(
              () => api("/platform/billing/run", { method: "POST" }),
              l("Tagihan perpanjangan dibuat.", "Renewal invoices generated."),
            )
          }
        >
          {l("Buat tagihan perpanjangan", "Generate renewal invoices")}
        </button>
      </header>
      <nav className="tabs">
        {(
          [
            ["tenants", l("Tenant", "Tenants")],
            ["plans", l("Paket langganan", "Subscription plans")],
            ["invoices", `${l("Tagihan terbuka", "Open invoices")} (${invoices.length})`],
          ] as [Tab, string][]
        ).map(([k, t]) => (
          <button key={k} type="button" className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
            {t}
          </button>
        ))}
      </nav>
      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      {tab === "invoices" && (
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
      )}

      {tab === "tenants" && (
        <>
          {freeForm && (
            <form className="panel" onSubmit={saveFree}>
              <h2>
                {l("Beri gratis", "Make complimentary")}: {freeForm.tenant.slug}
              </h2>
              <p className="muted">
                {l(
                  "Tenant memakai paket ini tanpa tagihan. Tagihan terbuka dibatalkan dan perpanjangan tidak ditagih. Setelah tanggal akhir, langganan kembali mengikuti periode/uji coba biasa.",
                  "The tenant uses this plan without invoices. Open invoices are voided and renewals are not billed. After the end date the subscription follows its normal period/trial again.",
                )}
              </p>
              <div className="grid-2">
                <label className="field">
                  <span>{l("Paket", "Plan")}</span>
                  <select
                    value={freeForm.planCode}
                    onChange={(e) => setFreeForm({ ...freeForm, planCode: e.target.value })}
                  >
                    {plans.map((p) => (
                      <option key={p.id} value={p.code}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{l("Gratis sampai (kosong = tanpa batas)", "Free until (empty = no end)")}</span>
                  <input
                    type="date"
                    value={freeForm.until}
                    onChange={(e) => setFreeForm({ ...freeForm, until: e.target.value })}
                  />
                </label>
              </div>
              <label className="field">
                <span>{l("Catatan", "Note")}</span>
                <input
                  maxLength={300}
                  placeholder={l("mis. mitra program UMKM", "e.g. SME partner program")}
                  value={freeForm.note}
                  onChange={(e) => setFreeForm({ ...freeForm, note: e.target.value })}
                />
              </label>
              <div className="toolbar">
                <button type="submit" className="primary">
                  {l("Simpan", "Save")}
                </button>
                <button type="button" onClick={() => setFreeForm(null)}>
                  {l("Batal", "Cancel")}
                </button>
              </div>
            </form>
          )}
          <input
            className="perm-search"
            placeholder={l("Cari tenant atau paket…", "Search tenant or plan…")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
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
                {(tenants ?? [])
                  .filter(
                    (t) =>
                      !query ||
                      `${t.slug} ${t.name} ${t.planName ?? ""}`
                        .toLowerCase()
                        .includes(query.trim().toLowerCase()),
                  )
                  .map((t) => (
                    <tr key={t.id}>
                      <td>{t.slug}</td>
                      <td>{t.name}</td>
                      <td>
                        <select
                          aria-label={l("Paket", "Plan")}
                          value={t.planCode ?? ""}
                          onChange={(e) => void patch(t, { planCode: e.target.value })}
                        >
                          {!t.planCode && <option value="">—</option>}
                          {plans.map((p) => (
                            <option key={p.id} value={p.code}>
                              {p.name}
                              {p.active ? "" : ` (${l("nonaktif", "inactive")})`}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {t.status ? tx(SUBSCRIPTION_STATUS_LABEL[t.status]!) : "—"}
                        {t.complimentary && t.complimentaryNote && (
                          <div className="small muted">{t.complimentaryNote}</div>
                        )}
                      </td>
                      <td>
                        {t.status === "complimentary"
                          ? t.complimentaryUntil
                            ? date(t.complimentaryUntil, locale)
                            : l("Tanpa batas", "No end")
                          : date(t.status === "trialing" ? t.trialEndsAt : t.currentPeriodEnd, locale)}
                      </td>
                      <td className="actions">
                        {t.complimentary ? (
                          <button
                            className="link"
                            onClick={() => {
                              if (
                                window.confirm(
                                  l(`Cabut gratis ${t.slug}?`, `Revoke free plan for ${t.slug}?`),
                                )
                              )
                                void patch(t, { complimentary: false });
                            }}
                          >
                            {l("Cabut gratis", "Revoke free")}
                          </button>
                        ) : (
                          <button
                            className="link"
                            onClick={() =>
                              setFreeForm({
                                tenant: t,
                                planCode: t.planCode ?? plans[0]?.code ?? "",
                                until: "",
                                note: "",
                              })
                            }
                          >
                            {l("Beri gratis", "Make free")}
                          </button>
                        )}
                        <button className="link" onClick={() => extendTrial(t)}>
                          {l("Perpanjang uji coba", "Extend trial")}
                        </button>
                        {t.status === "suspended" ? (
                          <button className="link" onClick={() => void patch(t, { status: "active" })}>
                            {l("Aktifkan", "Reactivate")}
                          </button>
                        ) : (
                          <button
                            className="link danger"
                            onClick={() => {
                              if (window.confirm(l(`Tangguhkan ${t.slug}?`, `Suspend ${t.slug}?`)))
                                void patch(t, { status: "suspended" });
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
      )}

      {tab === "plans" && (
        <>
          {planForm ? (
            <form className="panel" onSubmit={savePlan}>
              <h2>
                {planForm.id
                  ? `${l("Ubah paket", "Edit plan")} ${planForm.name}`
                  : l("Paket baru", "New plan")}
              </h2>
              <div className="grid-2">
                <label className="field">
                  <span>{l("Kode", "Code")} *</span>
                  <input
                    required
                    pattern={"[a-z0-9\\-]{2,50}"}
                    value={planForm.code}
                    onChange={(e) => setPlanForm({ ...planForm, code: e.target.value.toLowerCase() })}
                  />
                  <small className="muted">{l("huruf kecil, angka, tanda -", "lowercase, digits, -")}</small>
                  {err("code")}
                </label>
                <label className="field">
                  <span>{l("Nama", "Name")} *</span>
                  <input
                    required
                    value={planForm.name}
                    onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })}
                  />
                  {err("name")}
                </label>
                <label className="field">
                  <span>{l("Harga bulanan (Rp)", "Monthly price (IDR)")}</span>
                  <input
                    type="number"
                    min="0"
                    value={planForm.priceMonthly}
                    onChange={(e) => setPlanForm({ ...planForm, priceMonthly: e.target.value })}
                  />
                  {err("priceMonthly")}
                </label>
                <label className="field">
                  <span>{l("Harga tahunan (Rp)", "Yearly price (IDR)")}</span>
                  <input
                    type="number"
                    min="0"
                    value={planForm.priceYearly}
                    onChange={(e) => setPlanForm({ ...planForm, priceYearly: e.target.value })}
                  />
                  {err("priceYearly")}
                </label>
                <label className="field">
                  <span>
                    {l("Maks. pengguna aktif (kosong = tanpa batas)", "Max active users (empty = unlimited)")}
                  </span>
                  <input
                    type="number"
                    min="1"
                    value={planForm.maxUsers}
                    onChange={(e) => setPlanForm({ ...planForm, maxUsers: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>
                    {l("Maks. perusahaan (kosong = tanpa batas)", "Max companies (empty = unlimited)")}
                  </span>
                  <input
                    type="number"
                    min="1"
                    value={planForm.maxCompanies}
                    onChange={(e) => setPlanForm({ ...planForm, maxCompanies: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>{l("Urutan tampil", "Display order")}</span>
                  <input
                    type="number"
                    value={planForm.sort}
                    onChange={(e) => setPlanForm({ ...planForm, sort: e.target.value })}
                  />
                </label>
                <div className="field">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={planForm.public}
                      onChange={(e) => setPlanForm({ ...planForm, public: e.target.checked })}
                    />
                    {l("Tampil di halaman Langganan tenant", "Shown on tenants' Subscription page")}
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={planForm.active}
                      onChange={(e) => setPlanForm({ ...planForm, active: e.target.checked })}
                    />
                    {l("Aktif (bisa dipilih)", "Active (can be chosen)")}
                  </label>
                </div>
              </div>
              <label className="field">
                <span>{l("Deskripsi", "Description")}</span>
                <textarea
                  rows={2}
                  value={planForm.description}
                  onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })}
                />
              </label>
              <fieldset className="bare">
                <legend className="small muted">{l("Modul termasuk", "Included modules")}</legend>
                <div className="check-grid">
                  {MODULES.map(([k, id, en]) => (
                    <label key={k} className="check">
                      <input
                        type="checkbox"
                        checked={planForm.modules.includes(k)}
                        onChange={(e) =>
                          setPlanForm({
                            ...planForm,
                            modules: e.target.checked
                              ? [...planForm.modules, k]
                              : planForm.modules.filter((m) => m !== k),
                          })
                        }
                      />
                      {l(id, en)}
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="muted small">
                {l(
                  "Harga 0 = tidak bisa dipesan sendiri oleh tenant (diberikan oleh admin platform).",
                  "Price 0 = tenants cannot order it themselves (assigned by a platform admin).",
                )}
              </p>
              <div className="toolbar">
                <button type="submit" className="primary">
                  {l("Simpan paket", "Save plan")}
                </button>
                <button type="button" onClick={() => setPlanForm(null)}>
                  {l("Batal", "Cancel")}
                </button>
              </div>
            </form>
          ) : (
            <div className="toolbar">
              <button type="button" className="primary" onClick={() => setPlanForm(EMPTY_PLAN)}>
                {l("Tambah paket", "Add plan")}
              </button>
            </div>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{l("Kode", "Code")}</th>
                  <th>{l("Nama", "Name")}</th>
                  <th className="num">{l("Bulanan", "Monthly")}</th>
                  <th className="num">{l("Tahunan", "Yearly")}</th>
                  <th className="num">{l("Pengguna", "Users")}</th>
                  <th className="num">{l("Perusahaan", "Companies")}</th>
                  <th>{l("Modul", "Modules")}</th>
                  <th>{l("Status", "Status")}</th>
                  <th className="num">Tenant</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id}>
                    <td>{p.code}</td>
                    <td>{p.name}</td>
                    <td className="num">{money(p.priceMonthly, locale, 0)}</td>
                    <td className="num">{money(p.priceYearly, locale, 0)}</td>
                    <td className="num">{limit(p.maxUsers)}</td>
                    <td className="num">{limit(p.maxCompanies)}</td>
                    <td className="small">{p.modules.map(moduleLabel).join(", ")}</td>
                    <td>
                      <span className="badge">
                        {p.active ? l("Aktif", "Active") : l("Nonaktif", "Inactive")}
                      </span>{" "}
                      {!p.public && <span className="badge">{l("Tersembunyi", "Hidden")}</span>}
                    </td>
                    <td className="num">{p.tenantCount}</td>
                    <td className="actions">
                      <button className="link" onClick={() => editPlan(p)}>
                        {l("Ubah", "Edit")}
                      </button>
                      <button
                        className="link danger"
                        onClick={() => {
                          if (window.confirm(l(`Hapus paket ${p.name}?`, `Delete plan ${p.name}?`)))
                            void run(
                              () => api(`/platform/plans/${p.id}`, { method: "DELETE" }),
                              l("Paket dihapus.", "Plan deleted."),
                            );
                        }}
                      >
                        {l("Hapus", "Delete")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
