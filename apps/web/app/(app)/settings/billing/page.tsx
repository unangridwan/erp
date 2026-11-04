"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../../../lib/api";
import { formatDate, money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { SUBSCRIPTION_STATUS_LABEL } from "../../../../lib/resources";
import { SortTh, TablePager, TableTools, type ViewColumn } from "../../../../components/data-table";
import { useTableView } from "../../../../lib/use-table-view";

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
}

interface Invoice {
  id: string;
  number: string;
  planName: string;
  billingCycle: string;
  purpose: string;
  total: string;
  status: string;
  issuedAt: string;
  dueAt: string;
  paidAt: string | null;
  paymentUrl: string | null;
}

interface Billing {
  subscription: {
    status: string;
    billingCycle: string;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    complimentaryUntil: string | null;
  };
  plan: Plan;
  usage: { users: number; companies: number };
  plans: Plan[];
  invoices: Invoice[];
}

const MODULE_LABEL: Record<string, string> = {
  accounting: "Akuntansi",
  crm: "CRM",
  sales: "Penjualan",
  purchase: "Pembelian",
  inventory: "Persediaan",
  tax: "Pajak Coretax",
  hr: "SDM",
  payroll: "Payroll",
  consolidation: "Konsolidasi",
};

const date = (v: string | null, locale: "id" | "en") => (v ? formatDate(v.slice(0, 10), locale) : "—");

export default function BillingPage() {
  const { l, tx, locale } = useI18n();
  const [data, setData] = useState<Billing | null>(null);
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly");
  const [instructions, setInstructions] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const invoiceColumns = useMemo<ViewColumn<Invoice>[]>(
    () => [
      { key: "number", label: l("Nomor", "Number"), value: (i) => i.number },
      { key: "plan", label: l("Paket", "Plan"), type: "enum", value: (i) => i.planName },
      { key: "issuedAt", label: l("Terbit", "Issued"), type: "date", value: (i) => i.issuedAt },
      { key: "dueAt", label: l("Jatuh tempo", "Due"), type: "date", value: (i) => i.dueAt },
      {
        key: "total",
        label: l("Total (incl. PPN)", "Total (incl. VAT)"),
        type: "number",
        value: (i) => Number(i.total),
      },
      {
        key: "status",
        label: l("Status", "Status"),
        type: "enum",
        value: (i) => i.status,
        optionLabel: (v) =>
          v === "paid" ? l("Lunas", "Paid") : v === "void" ? l("Batal", "Void") : l("Belum dibayar", "Open"),
      },
    ],
    [l],
  );
  const invoiceTable = useTableView(data?.invoices ?? [], invoiceColumns, {
    storageKey: "billing-invoices",
    defaultSort: { key: "issuedAt", dir: "desc" },
  });

  const load = useCallback(() => {
    api<Billing>("/billing")
      .then(setData)
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

  async function pay(result: {
    invoice: Invoice & { paymentUrl: string | null };
    instructions: string | null;
  }) {
    if (result.invoice.paymentUrl) window.location.href = result.invoice.paymentUrl;
    else setInstructions(result.instructions);
  }

  if (!data) return error ? <p className="error">{error}</p> : <p className="muted">…</p>;
  const { subscription: sub, plan, usage } = data;
  const banner =
    sub.status === "expired" || sub.status === "suspended" ? "bad" : sub.status === "past_due" ? "warn" : "";

  return (
    <>
      <header className="toolbar">
        <h1>{l("Langganan", "Subscription")}</h1>
      </header>
      {error && <p className="error">{error}</p>}
      <div className={`banner ${banner}`}>
        <strong>
          {l("Paket", "Plan")} {plan.name}
        </strong>
        <span className="badge">
          {tx(SUBSCRIPTION_STATUS_LABEL[sub.status] ?? SUBSCRIPTION_STATUS_LABEL.active!)}
        </span>
        {sub.status === "trialing" && (
          <span>
            {l("Uji coba berakhir", "Trial ends")} {date(sub.trialEndsAt, locale)}
          </span>
        )}
        {sub.status === "complimentary" && (
          <span>
            {sub.complimentaryUntil
              ? `${l("Gratis dari kami sampai", "Free from us until")} ${date(sub.complimentaryUntil, locale)}`
              : l("Gratis dari kami tanpa batas waktu", "Free from us with no end date")}
          </span>
        )}
        {sub.currentPeriodEnd && sub.status !== "trialing" && sub.status !== "complimentary" && (
          <span>
            {l("Periode sampai", "Period until")} {date(sub.currentPeriodEnd, locale)}
          </span>
        )}
        <span className="muted">
          {l("Pengguna", "Users")} {usage.users}
          {plan.maxUsers ? `/${plan.maxUsers}` : ""} · {l("Perusahaan", "Companies")} {usage.companies}
          {plan.maxCompanies ? `/${plan.maxCompanies}` : ""}
        </span>
        {sub.status === "active" && (
          <button
            className="link danger"
            onClick={() => run(() => api("/billing/cancel", { method: "POST" }))}
          >
            {l("Berhenti di akhir periode", "Cancel at period end")}
          </button>
        )}
        {sub.status === "cancelling" && (
          <button className="link" onClick={() => run(() => api("/billing/resume", { method: "POST" }))}>
            {l("Lanjutkan langganan", "Resume subscription")}
          </button>
        )}
      </div>
      {instructions && (
        <div className="panel">
          <h2>{l("Instruksi pembayaran", "Payment instructions")}</h2>
          <p style={{ whiteSpace: "pre-line" }}>{instructions}</p>
        </div>
      )}

      <div className="toolbar">
        <h2>{l("Pilih paket", "Choose a plan")}</h2>
        <div className="tabs">
          <button className={cycle === "monthly" ? "primary" : ""} onClick={() => setCycle("monthly")}>
            {l("Bulanan", "Monthly")}
          </button>
          <button className={cycle === "yearly" ? "primary" : ""} onClick={() => setCycle("yearly")}>
            {l("Tahunan (hemat 2 bulan)", "Yearly (2 months free)")}
          </button>
        </div>
      </div>
      <div className="cards">
        {data.plans.map((p) => (
          <div key={p.id} className={`card ${p.code === plan.code ? "current" : ""}`}>
            <strong>{p.name}</strong>
            <span className="price">
              Rp {money(cycle === "yearly" ? p.priceYearly : p.priceMonthly, locale)}
              <span className="muted small">
                {" "}
                /{cycle === "yearly" ? l("tahun", "year") : l("bulan", "month")}
              </span>
            </span>
            <span className="muted small">{l("Belum termasuk PPN", "Excl. VAT")}</span>
            {p.description && <span>{p.description}</span>}
            <span className="small">
              {p.maxUsers
                ? l(`Maks. ${p.maxUsers} pengguna`, `Up to ${p.maxUsers} users`)
                : l("Pengguna tanpa batas", "Unlimited users")}
              {" · "}
              {p.maxCompanies
                ? l(`${p.maxCompanies} perusahaan`, `${p.maxCompanies} companies`)
                : l("Perusahaan tanpa batas", "Unlimited companies")}
            </span>
            <span className="small muted">{p.modules.map((m) => MODULE_LABEL[m] ?? m).join(", ")}</span>
            {Number(cycle === "yearly" ? p.priceYearly : p.priceMonthly) <= 0 ? (
              <span className="small muted">
                {p.code === plan.code
                  ? l("Paket Anda saat ini", "Your current plan")
                  : l("Hubungi kami untuk paket ini", "Contact us for this plan")}
              </span>
            ) : (
              <button
                className="primary"
                onClick={() =>
                  run(async () =>
                    pay(
                      await api("/billing/subscribe", {
                        method: "POST",
                        body: { planCode: p.code, billingCycle: cycle },
                      }),
                    ),
                  )
                }
              >
                {p.code === plan.code && sub.status === "active"
                  ? l("Perpanjang", "Renew")
                  : l("Pilih paket", "Choose")}
              </button>
            )}
          </div>
        ))}
      </div>

      <h2>{l("Tagihan", "Invoices")}</h2>
      <TableTools view={invoiceTable} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <SortTh view={invoiceTable} col="number">
                {l("Nomor", "Number")}
              </SortTh>
              <SortTh view={invoiceTable} col="plan">
                {l("Paket", "Plan")}
              </SortTh>
              <SortTh view={invoiceTable} col="issuedAt">
                {l("Terbit", "Issued")}
              </SortTh>
              <SortTh view={invoiceTable} col="dueAt">
                {l("Jatuh tempo", "Due")}
              </SortTh>
              <SortTh view={invoiceTable} col="total" className="num">
                {l("Total (incl. PPN)", "Total (incl. VAT)")}
              </SortTh>
              <SortTh view={invoiceTable} col="status">
                {l("Status", "Status")}
              </SortTh>
              <th />
            </tr>
          </thead>
          <tbody>
            {invoiceTable.rows.map((i) => (
              <tr key={i.id}>
                <td>{i.number}</td>
                <td>
                  {i.planName} ·{" "}
                  {i.billingCycle === "yearly" ? l("tahunan", "yearly") : l("bulanan", "monthly")}
                  {i.purpose === "renewal" && (
                    <span className="muted small"> ({l("perpanjangan", "renewal")})</span>
                  )}
                </td>
                <td>{date(i.issuedAt, locale)}</td>
                <td>{date(i.dueAt, locale)}</td>
                <td className="num">{money(i.total, locale)}</td>
                <td>
                  <span
                    className={`badge ${i.status === "paid" ? "state-posted" : i.status === "void" ? "state-cancel" : "state-sent"}`}
                  >
                    {i.status === "paid"
                      ? l("Lunas", "Paid")
                      : i.status === "void"
                        ? l("Batal", "Void")
                        : l("Belum dibayar", "Open")}
                  </span>
                </td>
                <td>
                  {i.status === "open" && (
                    <button
                      className="link"
                      onClick={() =>
                        run(async () => pay(await api(`/billing/invoices/${i.id}/pay`, { method: "POST" })))
                      }
                    >
                      {l("Bayar", "Pay")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {invoiceTable.rows.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  {data.invoices.length
                    ? l("Tidak ada data yang cocok dengan filter.", "No rows match the filters.")
                    : l("Belum ada tagihan.", "No invoices yet.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <TablePager view={invoiceTable} />
    </>
  );
}
