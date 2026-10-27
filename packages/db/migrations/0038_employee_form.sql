-- Form karyawan: tag bebas & undangan portal yang tertaut ke karyawan.
alter table employees
  add column tags text[] not null default '{}';
create index employees_tags_idx on employees using gin (tags);

-- Undangan portal dari data karyawan: saat diterima, akun baru ditautkan ke karyawan ini.
alter table invitations
  add column employee_id uuid,
  add foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete set null (employee_id);
