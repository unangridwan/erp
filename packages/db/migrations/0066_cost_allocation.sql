-- Controlling: alokasi biaya periodik antar cost center (persen tetap atau kunci statistik).

-- Kunci statistik: jumlah karyawan (otomatis) atau angka yang diinput per cost center (m², jam mesin, dll).
create table statistical_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  code text not null check (char_length(code) between 1 and 20),
  name text not null check (char_length(name) between 1 and 120),
  unit text check (char_length(unit) <= 20),
  kind text not null default 'manual' check (kind in ('manual', 'headcount')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade
);

-- Nilai kunci manual per cost center, berlaku mulai bulan `period` (tanggal 1) sampai ada nilai bulan berikutnya.
create table statistical_key_values (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  key_id uuid not null,
  cost_center_id uuid not null,
  period date not null check (extract(day from period) = 1),
  value numeric(20, 4) not null check (value >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (key_id, cost_center_id, period),
  foreign key (tenant_id, key_id) references statistical_keys (tenant_id, id) on delete cascade,
  foreign key (tenant_id, cost_center_id) references cost_centers (tenant_id, id) on delete cascade
);

-- Siklus alokasi: biaya cost center sumber (akun beban, opsional dibatasi akun tertentu) dibagi ke penerima.
create table allocation_cycles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  code text not null check (char_length(code) between 1 and 20),
  name text not null check (char_length(name) between 1 and 120),
  -- Urutan jalan: siklus berikutnya ikut membagi biaya yang diterima dari siklus sebelumnya (bertingkat).
  sequence smallint not null default 10 check (sequence between 1 and 999),
  source_cost_center_id uuid not null,
  -- Kosong = semua akun beban; selain itu hanya akun-akun ini.
  account_ids uuid[] not null default '{}',
  method text not null check (method in ('percent', 'key')),
  key_id uuid,
  journal_id uuid,
  active boolean not null default true,
  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code),
  unique (tenant_id, id),
  check (method <> 'key' or key_id is not null),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, source_cost_center_id) references cost_centers (tenant_id, id),
  foreign key (tenant_id, key_id) references statistical_keys (tenant_id, id),
  foreign key (tenant_id, journal_id) references journals (tenant_id, id)
);

create table allocation_receivers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  cycle_id uuid not null,
  cost_center_id uuid not null,
  -- Dipakai metode persen (total 100); metode kunci memakai nilai kunci statistik penerima.
  percent numeric(7, 4) check (percent > 0 and percent <= 100),
  unique (cycle_id, cost_center_id),
  foreign key (tenant_id, cycle_id) references allocation_cycles (tenant_id, id) on delete cascade,
  foreign key (tenant_id, cost_center_id) references cost_centers (tenant_id, id)
);

-- Hasil jalan per siklus per bulan; satu jalan aktif (posted) per siklus per periode.
create table allocation_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  cycle_id uuid not null,
  period date not null check (extract(day from period) = 1),
  state text not null default 'posted' check (state in ('posted', 'reversed')),
  amount numeric(20, 2) not null,
  -- Rincian: [{costCenterId, basis, share, amount}] dan per akun.
  details jsonb not null default '[]',
  move_id uuid,
  reversal_move_id uuid,
  created_by uuid,
  reversed_by uuid,
  reversed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, cycle_id) references allocation_cycles (tenant_id, id),
  foreign key (tenant_id, move_id) references account_moves (tenant_id, id),
  foreign key (tenant_id, reversal_move_id) references account_moves (tenant_id, id)
);
create unique index allocation_runs_active_uq on allocation_runs (cycle_id, period) where state = 'posted';

-- Penanda entri hasil alokasi (dikecualikan saat menghitung biaya sumber siklus yang sama).
alter table account_moves add column allocation_cycle_id uuid,
  add foreign key (tenant_id, allocation_cycle_id) references allocation_cycles (tenant_id, id);

do $$
declare t text;
begin
  foreach t in array array['statistical_keys', 'statistical_key_values', 'allocation_cycles', 'allocation_receivers',
    'allocation_runs'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
