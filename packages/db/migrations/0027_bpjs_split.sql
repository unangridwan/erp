-- BPJS Kesehatan dan BPJS Ketenagakerjaan selalu terpisah: kepesertaan per program di data karyawan, iuran & dasar
-- upah per program di slip, serta akun beban/utang per program di jurnal gaji.

alter table employees
  add column bpjs_kes_enrolled boolean not null default true,
  add column bpjs_kes_date date,
  add column bpjs_kes_class smallint check (bpjs_kes_class is null or bpjs_kes_class between 1 and 3),
  add column bpjs_kes_facility text,
  add column bpjs_tk_enrolled boolean not null default true,
  add column bpjs_tk_date date,
  -- Jaminan Pensiun (bagian BPJS Ketenagakerjaan), mis. tidak untuk yang melewati usia pensiun.
  add column bpjs_jp_enrolled boolean not null default true;

alter table payslips
  add column kes_employee numeric(20, 2) not null default 0,
  add column kes_employer numeric(20, 2) not null default 0,
  add column tk_employee numeric(20, 2) not null default 0,
  add column tk_employer numeric(20, 2) not null default 0,
  add column bpjs_kes_wage numeric(20, 2) not null default 0,
  add column bpjs_tk_wage numeric(20, 2) not null default 0;

-- Isi slip lama dari baris per kode (BPJS_KES_* = Kesehatan; JHT/JKK/JKM/JP = Ketenagakerjaan).
update payslips p set
  kes_employee = coalesce((select -sum(l.amount) from payslip_lines l
    where l.payslip_id = p.id and l.category = 'bpjs_employee' and l.code like 'BPJS_KES%'), 0),
  kes_employer = coalesce((select sum(l.amount) from payslip_lines l
    where l.payslip_id = p.id and l.category = 'bpjs_employer' and l.code like 'BPJS_KES%'), 0),
  tk_employee = coalesce((select -sum(l.amount) from payslip_lines l
    where l.payslip_id = p.id and l.category = 'bpjs_employee' and l.code not like 'BPJS_KES%'), 0),
  tk_employer = coalesce((select sum(l.amount) from payslip_lines l
    where l.payslip_id = p.id and l.category = 'bpjs_employer' and l.code not like 'BPJS_KES%'), 0),
  bpjs_kes_wage = least(p.bpjs_wage, coalesce((select s.kes_wage_cap from payroll_settings s
    where s.company_id = p.company_id), 12000000)),
  bpjs_tk_wage = p.bpjs_wage;

-- Akun per program. Akun bawaan lama (6-1100 "Beban BPJS", 2-1400 "Utang BPJS") menjadi akun Ketenagakerjaan bila
-- namanya belum diubah pengguna; akun Kesehatan baru 6-1110 & 2-1410.
update accounts set name = 'Beban BPJS Ketenagakerjaan' where code = '6-1100' and name = 'Beban BPJS';
update accounts set name = 'Utang BPJS Ketenagakerjaan' where code = '2-1400' and name = 'Utang BPJS';
insert into accounts (tenant_id, company_id, code, name, account_type)
select s.tenant_id, s.company_id, '6-1110', 'Beban BPJS Kesehatan', 'expense' from payroll_settings s
on conflict (company_id, code) do nothing;
insert into accounts (tenant_id, company_id, code, name, account_type)
select s.tenant_id, s.company_id, '2-1410', 'Utang BPJS Kesehatan', 'liability_current' from payroll_settings s
on conflict (company_id, code) do nothing;

alter table payroll_settings rename column bpjs_expense_account_id to bpjs_tk_expense_account_id;
alter table payroll_settings rename column bpjs_payable_account_id to bpjs_tk_payable_account_id;
alter table payroll_settings
  add column bpjs_kes_expense_account_id uuid,
  add column bpjs_kes_payable_account_id uuid,
  add foreign key (tenant_id, bpjs_kes_expense_account_id) references accounts (tenant_id, id),
  add foreign key (tenant_id, bpjs_kes_payable_account_id) references accounts (tenant_id, id);
update payroll_settings s set
  bpjs_kes_expense_account_id = coalesce(
    (select a.id from accounts a where a.company_id = s.company_id and a.code = '6-1110'), s.bpjs_tk_expense_account_id),
  bpjs_kes_payable_account_id = coalesce(
    (select a.id from accounts a where a.company_id = s.company_id and a.code = '2-1410'), s.bpjs_tk_payable_account_id);
alter table payroll_settings
  alter column bpjs_kes_expense_account_id set not null,
  alter column bpjs_kes_payable_account_id set not null;
