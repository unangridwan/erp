const modules = [
  { name: "CRM", desc: "Lead & pipeline penjualan" },
  { name: "Penjualan", desc: "Penawaran, sales order, faktur" },
  { name: "Pembelian", desc: "RFQ, purchase order, tagihan vendor" },
  { name: "Persediaan", desc: "Gudang, stok, valuasi" },
  { name: "Akuntansi", desc: "Jurnal, buku besar, laporan keuangan" },
  { name: "SDM & Penggajian", desc: "Karyawan, absensi, PPh 21, BPJS" },
  { name: "Konsolidasi", desc: "Holding, anak perusahaan, unit bisnis, cabang" },
];

export default function Home() {
  return (
    <main className="shell">
      <h1>ERP</h1>
      <p>Pilih modul untuk memulai.</p>
      <ul className="grid">
        {modules.map((m) => (
          <li key={m.name} className="card">
            <strong>{m.name}</strong>
            <span>{m.desc}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
