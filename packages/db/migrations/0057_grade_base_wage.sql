-- Gaji pokok standar per golongan upah: terisi otomatis di kontrak (tetap bisa diubah).
alter table salary_grades add column base_wage numeric(20, 2);
alter table salary_grades add constraint salary_grades_base_wage_check
  check (base_wage is null or (base_wage >= min_wage and base_wage <= max_wage));

-- Golongan & gaji pokok standar yang berlaku saat kontrak dibuat; kontrak "mengikuti standar" bila wage = grade_base_wage.
alter table contracts add column grade_id uuid;
alter table contracts add column grade_base_wage numeric(20, 2);
alter table contracts
  add foreign key (tenant_id, grade_id) references salary_grades (tenant_id, id) on delete set null (grade_id);
create index contracts_grade_idx on contracts (grade_id) where grade_id is not null;

update contracts c set grade_id = coalesce(e.grade_id, j.grade_id)
from employees e
left join job_positions j on j.id = e.job_id
where e.id = c.employee_id and c.wage_type = 'monthly' and coalesce(e.grade_id, j.grade_id) is not null;
