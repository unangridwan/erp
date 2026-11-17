-- Satu jalur perubahan upah: penyesuaian upah tanpa perubahan jabatan (mis. gaji pokok golongan baru) dicatat sebagai
-- SK mutasi jenis `wage_adjustment` sehingga ikut alur persetujuan & riwayat yang sama dengan promosi/mutasi.
alter table employee_movements drop constraint if exists employee_movements_kind_check;
alter table employee_movements add constraint employee_movements_kind_check
  check (kind in ('promotion', 'demotion', 'transfer', 'rotation', 'wage_adjustment'));
