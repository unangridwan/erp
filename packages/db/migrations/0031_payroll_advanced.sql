-- Payroll lanjutan: gross-up PPh 21 per kontrak, payroll koreksi (off-cycle) untuk masa yang sudah diposting,
-- penahanan gaji per slip (dibayar terpisah saat dilepas).

alter table contracts
  add column tax_method text not null default 'gross' check (tax_method in ('gross', 'gross_up'));

alter table payroll_runs
  add column kind text not null default 'regular' check (kind in ('regular', 'correction')),
  add column corrects_run_id uuid,
  add constraint payroll_runs_corrects_fk
    foreign key (tenant_id, corrects_run_id) references payroll_runs (tenant_id, id) on delete restrict,
  add constraint payroll_runs_correction_ck check ((kind = 'correction') = (corrects_run_id is not null));

-- Satu payroll reguler per bulan; payroll koreksi boleh lebih dari satu.
drop index payroll_runs_period_uq;
create unique index payroll_runs_period_uq on payroll_runs (company_id, period_start)
  where state <> 'cancel' and kind = 'regular';

alter table payslips
  add column hold_reason text check (char_length(hold_reason) <= 200),
  add column held_at timestamptz,
  add column held_by uuid,
  add column released_at timestamptz,
  add column release_move_id uuid;
