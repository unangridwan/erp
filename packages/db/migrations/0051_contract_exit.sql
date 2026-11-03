-- Tanggal masuk & keluar karyawan diinput hanya di kontrak kerja: tanggal masuk = mulai kontrak pertama, tanggal
-- keluar = kontrak diakhiri dengan alasan keluar (resign, habis kontrak, PHK, …). Kolom employees.join_date /
-- resign_date / resign_reason / resign_note tetap ada sebagai salinan untuk laporan & payroll.

alter table contracts
  add column end_reason text check (end_reason in ('resign', 'end_contract', 'termination', 'retirement', 'death', 'other')),
  add column end_note text check (char_length(end_note) <= 1000),
  -- Status & tanggal berakhir sebelum diproses keluar, dipulihkan saat keluar dibatalkan.
  add column pre_exit_state text check (pre_exit_state in ('running', 'closed')),
  add column pre_exit_date_end date;

-- Data lama: kontrak yang berakhir di tanggal keluar karyawan menjadi kontrak "keluar".
update contracts c
set end_reason = coalesce(e.resign_reason, 'other'), end_note = e.resign_note
from employees e
where c.employee_id = e.id
  and e.resign_date is not null
  and c.date_end = e.resign_date
  and c.state in ('running', 'closed');
