"use client";

import Link from "next/link";
import { useMe } from "../../components/me-context";
import { L, useI18n, type Text } from "../../lib/i18n";

const MODULES: { name: Text; desc: Text; phase: string; href?: string }[] = [
  { name: L("CRM", "CRM"), desc: L("Lead & pipeline penjualan", "Leads & sales pipeline"), phase: "2" },
  {
    name: L("Penjualan", "Sales"),
    desc: L("Penawaran, sales order, faktur", "Quotations, sales orders, invoices"),
    phase: "2",
  },
  {
    name: L("Pembelian", "Purchasing"),
    desc: L("RFQ, purchase order, tagihan vendor", "RFQs, purchase orders, vendor bills"),
    phase: "3",
  },
  {
    name: L("Persediaan", "Inventory"),
    desc: L("Gudang, stok, valuasi", "Warehouses, stock, valuation"),
    phase: "3",
  },
  {
    name: L("Akuntansi", "Accounting"),
    desc: L("Jurnal, buku besar, laporan keuangan", "Journals, ledger, financial reports"),
    phase: "1",
  },
  {
    name: L("SDM & Penggajian", "HR & Payroll"),
    desc: L("Karyawan, absensi, PPh 21, BPJS", "Employees, attendance, PPh 21, BPJS"),
    phase: "4",
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
              {"href" in m
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
