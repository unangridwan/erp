-- Aturan penggajian per jenis kontrak (bisa diatur tiap tenant): ikut payroll, BPJS per program, kategori PPh 21,
-- THR, lembur, dan pesangon/uang kompensasi. Kepesertaan BPJS efektif = jenis kontrak DAN centang di data karyawan.

alter table contract_types
  add column in_payroll boolean not null default true,
  add column bpjs_kes boolean not null default true,
  add column bpjs_jkk boolean not null default true,
  add column bpjs_jkm boolean not null default true,
  add column bpjs_jht boolean not null default true,
  add column bpjs_jp boolean not null default true,
  -- auto = ikut jenis upah (bulanan → pegawai tetap TER; harian/borongan → pegawai tidak tetap).
  add column pph21_category text not null default 'auto'
    check (pph21_category in ('auto', 'permanent', 'non_permanent', 'non_employee', 'none')),
  add column thr boolean not null default true,
  add column overtime boolean not null default true,
  add column severance text not null default 'pesangon' check (severance in ('pesangon', 'compensation', 'none'));

-- Bawaan per jenis (bisa diubah tenant di SDM › Konfigurasi › Jenis Kontrak).
update contract_types set severance = 'compensation' where code = 'pkwt';
update contract_types set severance = 'none' where code = 'harian';
update contract_types
  set bpjs_kes = false, bpjs_jht = false, bpjs_jp = false, thr = false, overtime = false, severance = 'none'
  where code = 'magang';
update contract_types
  set bpjs_kes = false, bpjs_jkk = false, bpjs_jkm = false, bpjs_jht = false, bpjs_jp = false,
      pph21_category = 'non_employee', thr = false, overtime = false, severance = 'none'
  where code = 'mitra';

-- Kategori PPh 21 slip (bukti potong A1/BPMP hanya untuk pegawai tetap).
alter table payslips
  add column tax_category text not null default 'permanent'
    check (tax_category in ('permanent', 'non_permanent', 'non_employee', 'none'));
update payslips p set tax_category = 'non_permanent'
  from contracts c where c.id = p.contract_id and c.wage_type <> 'monthly';
