"use client";

import Link from "next/link";
import { useMe } from "../../components/me-context";
import { L, useI18n, type Text } from "../../lib/i18n";

const MODULES: { name: Text; desc: Text; href?: string; phase?: string }[] = [
  {
    name: L("CRM", "CRM"),
    desc: L("Lead & pipeline penjualan", "Leads & sales pipeline"),
    href: "/crm/pipeline",
  },
  {
    name: L("Penjualan", "Sales"),
    desc: L("Penawaran, sales order, faktur", "Quotations, sales orders, invoices"),
    href: "/sales/quotations",
  },
  {
    name: L("Pembelian", "Purchasing"),
    desc: L("RFQ, purchase order, tagihan vendor", "RFQs, purchase orders, vendor bills"),
    href: "/purchase/rfq",
  },
  {
    name: L("Persediaan", "Inventory"),
    desc: L("Gudang, stok, valuasi", "Warehouses, stock, valuation"),
    href: "/inventory/overview",
  },
  {
    name: L("Akuntansi", "Accounting"),
    desc: L("Jurnal, buku besar, laporan keuangan", "Journals, ledger, financial reports"),
    href: "/accounting/reports",
  },
  {
    name: L("SDM & Penggajian", "HR & Payroll"),
    desc: L("Karyawan, absensi, PPh 21, BPJS", "Employees, attendance, PPh 21, BPJS"),
    href: "/payroll/runs",
  },
  {
    name: L("Pajak (Coretax)", "Tax (Coretax)"),
    desc: L(
      "Faktur pajak, faktur masukan, e-Bupot, rekap PPN",
      "Tax invoices, input VAT, e-Bupot, VAT summary",
    ),
    href: "/tax/invoices",
  },
  {
    name: L("Konsolidasi", "Consolidation"),
    desc: L("Laporan konsolidasian grup", "Group consolidated reports"),
    phase: "5b",
  },
];

export default function Dashboard() {
  const me = useMe();
  const { t, tx, locale } = useI18n();
  const active = me.companies.find((c) => c.id === me.activeCompanyId);
  return (
    <>
      <h1>
        {t("home.welcome")}, {me.name}
      </h1>
      <p className="muted">
        {t("app.activeCompany")}: {active?.name}
      </p>
      <h2>{t("home.start")}</h2>
      <p>
        <Link href="/onboarding">{locale === "id" ? "Panduan awal" : "Getting started"}</Link> ·{" "}
        <Link href="/companies">{locale === "id" ? "Struktur grup" : "Group structure"}</Link> ·{" "}
        <Link href="/partners">{locale === "id" ? "Kontak" : "Contacts"}</Link> ·{" "}
        <Link href="/products">{locale === "id" ? "Produk" : "Products"}</Link>
      </p>
      <h2>{t("home.modules")}</h2>
      <ul className="grid">
        {MODULES.map((m) => (
          <li key={m.name.id} className="card">
            <strong>{m.href ? <Link href={m.href}>{tx(m.name)}</Link> : tx(m.name)}</strong>
            <span>{tx(m.desc)}</span>
            <small className="badge">
              {m.href
                ? locale === "id"
                  ? "Tersedia"
                  : "Available"
                : locale === "id"
                  ? `Fase ${m.phase}`
                  : `Phase ${m.phase}`}
            </small>
          </li>
        ))}
      </ul>
    </>
  );
}
