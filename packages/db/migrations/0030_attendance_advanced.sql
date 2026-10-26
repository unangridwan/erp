-- Absensi lanjutan: lokasi kerja & geofence, validasi & kunci absensi, foto/IP/perangkat, kiosk (badge + PIN),
-- API push mesin absensi, koreksi absensi & tukar shift dengan persetujuan berjenjang, auto-checkout.

create table work_locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null,
  branch_id uuid,
  latitude numeric(9, 6) not null check (latitude between -90 and 90),
  longitude numeric(9, 6) not null check (longitude between -180 and 180),
  radius_m integer not null default 100 check (radius_m between 10 and 100000),
  -- true = absen di luar radius ditolak; false = hanya dicatat jaraknya.
  enforce_geofence boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade
);

alter table employees
  add column work_location_id uuid,
  add column badge_code text,
  add column attendance_pin_hash text,
  add constraint employees_work_location_fk
    foreign key (tenant_id, work_location_id) references work_locations (tenant_id, id) on delete set null (work_location_id);
create unique index employees_badge_uq on employees (company_id, badge_code) where badge_code is not null;

alter table attendances drop constraint attendances_source_check;
alter table attendances
  add constraint attendances_source_check
    check (source in ('web', 'manual', 'import', 'kiosk', 'device', 'request')),
  -- Data lama dianggap sudah valid; absensi baru menjadi draft bila validasi diaktifkan di Pengaturan Payroll.
  add column state text not null default 'validated' check (state in ('draft', 'validated', 'refused')),
  add column check_out_latitude numeric(9, 6),
  add column check_out_longitude numeric(9, 6),
  add column ip text,
  add column user_agent text,
  add column photo bytea check (photo is null or octet_length(photo) <= 1048576),
  add column photo_type text,
  add column work_location_id uuid,
  add column distance_m integer,
  -- Ditutup otomatis karena lupa absen pulang.
  add column auto_checkout boolean not null default false,
  add column note text,
  add column validated_by uuid,
  add column validated_at timestamptz,
  add column device_id uuid,
  add constraint attendances_location_fk
    foreign key (tenant_id, work_location_id) references work_locations (tenant_id, id) on delete set null (work_location_id);
create index attendances_open_idx on attendances (employee_id) where check_out is null;

-- Mesin absensi (fingerprint/face) yang mengirim log lewat API; kunci disimpan sebagai hash.
create table attendance_devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null,
  serial text,
  work_location_id uuid,
  key_hash text not null,
  active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, work_location_id) references work_locations (tenant_id, id) on delete set null (work_location_id)
);
alter table attendances add constraint attendances_device_fk
  foreign key (tenant_id, device_id) references attendance_devices (tenant_id, id) on delete set null (device_id);
-- Log mesin idempoten: satu karyawan tidak dicatat dua kali pada instan yang sama.
create unique index attendances_punch_uq on attendances (employee_id, check_in) where source = 'device';

-- Koreksi absensi oleh karyawan (lupa absen, dinas luar, WFH) dengan persetujuan berjenjang.
create table attendance_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  employee_id uuid not null,
  kind text not null default 'correction' check (kind in ('correction', 'business_trip', 'wfh')),
  date date not null,
  check_in timestamptz not null,
  check_out timestamptz,
  reason text not null check (char_length(reason) <= 200),
  attachment bytea check (attachment is null or octet_length(attachment) <= 5242880),
  attachment_name text,
  attachment_type text,
  state text not null default 'confirm' check (state in ('confirm', 'approved', 'refused', 'cancel')),
  approval_step smallint not null default 1,
  approval_levels smallint not null default 1,
  attendance_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade,
  foreign key (tenant_id, attendance_id) references attendances (tenant_id, id) on delete set null (attendance_id),
  check (check_out is null or check_out > check_in)
);

-- Permintaan tukar shift: jadwal yang diminta untuk suatu periode; jadwal saat pengajuan dicatat untuk deteksi
-- perubahan (pengajuan tidak bisa disetujui bila jadwal karyawan sudah berubah).
create table shift_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  employee_id uuid not null,
  schedule_id uuid not null,
  current_schedule_id uuid,
  date_from date not null,
  date_to date not null,
  reason text,
  state text not null default 'confirm' check (state in ('confirm', 'approved', 'refused', 'cancel')),
  approval_step smallint not null default 1,
  approval_levels smallint not null default 1,
  assignment_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade,
  foreign key (tenant_id, schedule_id) references work_schedules (tenant_id, id),
  foreign key (tenant_id, assignment_id) references shift_assignments (tenant_id, id) on delete set null (assignment_id),
  check (date_to >= date_from)
);

alter table approvals drop constraint approvals_res_model_check;
alter table approvals add constraint approvals_res_model_check
  check (res_model in ('leave_request', 'overtime', 'expense_claim', 'attendance_request', 'shift_request'));

alter table payroll_settings
  add column attendance_validation boolean not null default false,
  -- Absensi s.d. tanggal ini terkunci (tidak bisa diubah/dikoreksi); dimajukan otomatis saat payroll diposting.
  add column attendance_lock_date date,
  add column auto_checkout_hours smallint check (auto_checkout_hours is null or auto_checkout_hours between 4 and 24),
  add column attendance_approval_levels smallint not null default 1 check (attendance_approval_levels between 1 and 3);

do $$
declare t text;
begin
  foreach t in array array['work_locations', 'attendance_devices', 'attendance_requests', 'shift_requests'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
