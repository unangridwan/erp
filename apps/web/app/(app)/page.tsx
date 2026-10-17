"use client";

import Link from "next/link";
import { useMe } from "../../components/me-context";

const MODULES = [
  { name: "CRM", desc: "Lead & pipeline penjualan", phase: "Fase 2" },
  { name: "Penjualan", desc: "Penawaran, sales order, faktur", phase: "Fase 2" },
  { name: "Pembelian", desc: "RFQ, purchase order, tagihan vendor", phase: "Fase 3" },
  { name: "Persediaan", desc: "Gudang, stok, valuasi", phase: "Fase 3" },
  { name: "Akuntansi", desc: "Jurnal, buku besar, laporan keuangan", phase: "Fase 1" },
  { name: "SDM & Penggajian", desc: "Karyawan, absensi, PPh 21, BPJS", phase: "Fase 4" },
  { name: "Konsolidasi", desc: "Laporan konsolidasian grup", phase: "Fase 5b" },
];

export default function Dashboard() {
  const me = useMe();
  const active = me.companies.find((c) => c.id === me.activeCompanyId);
  return (
    <>
      <h1>Selamat datang, {me.name}</h1>
      <p className="muted">Perusahaan aktif: {active?.name}</p>
      <h2>Mulai dari master data</h2>
      <p>
        <Link href="/companies">Struktur grup</Link> · <Link href="/partners">Kontak</Link> ·{" "}
        <Link href="/products">Produk</Link>
      </p>
      <h2>Modul</h2>
      <ul className="grid">
        {MODULES.map((m) => (
          <li key={m.name} className="card">
            <strong>{m.name}</strong>
            <span>{m.desc}</span>
            <small className="badge">{m.phase}</small>
          </li>
        ))}
      </ul>
    </>
  );
}
