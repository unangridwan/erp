-- Hak upah lembur ditentukan per karyawan (bukan per jenis kontrak). Nilai awal mengikuti jenis kontrak terakhir.
alter table employees add column overtime_eligible boolean not null default true;

update employees e set overtime_eligible = false
where exists (
  select 1 from contracts c
  join contract_types t on t.tenant_id = c.tenant_id and t.code = c.contract_type
  where c.employee_id = e.id and t.overtime = false
    and c.date_start = (select max(c2.date_start) from contracts c2
                        where c2.employee_id = e.id and c2.state in ('draft', 'running', 'closed'))
);

alter table contract_types drop column overtime;
