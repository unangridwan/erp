# ADR 0001 — Modular monolith

- Status: Diterima
- Tanggal: 2026-10-17

## Konteks

ERP terdiri dari banyak modul (CRM, Sales, Purchase, Inventory, Accounting, HR, Payroll, Konsolidasi) yang
saling terhubung erat lewat transaksi (mis. SO → Delivery → Jurnal HPP). Tim awal kecil (3–5 developer).

## Keputusan

Satu deployable NestJS (`apps/api`) + worker (`apps/worker`), dengan logika domain per modul di
`packages/modules/*`. Modul berkomunikasi lewat domain event in-process dengan pola transactional outbox;
tidak boleh mengakses tabel modul lain secara langsung kecuali lewat service publiknya.

## Konsekuensi

- Transaksi lintas modul cukup satu transaksi database → konsistensi data akuntansi terjaga.
- Deploy & operasional sederhana.
- Batas modul harus dijaga disiplin (lint rule import boundary) agar bisa dipecah jadi service bila perlu.

## Pelaksanaan (diperbarui Oktober 2026)

- Belum ada `apps/worker` maupun `packages/modules/*`: modul domain berada di `apps/api/src/<modul>` (NestJS module),
  logika murni bersama di `packages/shared`. Job latar (tagihan, kurs, pengingat SDM/akrual cuti/auto-checkout/armada,
  webhook, laporan terjadwal) berjalan sebagai penjadwal di dalam proses API dan bisa dimatikan per instance
  (`*_SCHEDULER=off`, lihat `docs/operations.md`).
- Modul saling memanggil lewat service yang diekspor modul (mis. `ApprovalEngineService.onOutcome` untuk reaksi atas
  keputusan persetujuan), bukan domain event umum. Outbox transaksional baru dipakai untuk webhook keluar Aplikasi
  Terhubung (`webhook_deliveries`, diisi trigger database).
- Lint aturan batas impor antarmodul belum dipasang (utang teknis).
