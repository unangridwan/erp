-- Lembur otomatis dari absensi: jam lembur dihitung dari absen pulang (dan masuk lebih awal) terhadap jadwal kerja,
-- lalu atasan memvalidasi jamnya dan menyetujui atau menolak.

alter table overtimes
  add column source text not null default 'manual' check (source in ('manual', 'attendance')),
  add column attendance_id uuid,
  -- Jam hasil hitung absensi; `hours` = jam yang diajukan/disetujui (atasan boleh mengurangi).
  add column computed_hours numeric(5, 2),
  add foreign key (tenant_id, attendance_id) references attendances (tenant_id, id) on delete set null (attendance_id);
create unique index overtimes_attendance on overtimes (attendance_id) where attendance_id is not null;

alter table payroll_settings
  add column overtime_from_attendance boolean not null default false,
  add column overtime_min_minutes integer not null default 30 check (overtime_min_minutes between 0 and 240),
  add column overtime_round_minutes integer not null default 30 check (overtime_round_minutes between 1 and 60),
  add column overtime_max_hours integer not null default 4 check (overtime_max_hours between 1 and 12),
  add column overtime_count_early boolean not null default false;
