-- Golongan upah: gaji pokok wajib, upah minimum & maksimum (skala) opsional.
alter table salary_grades drop constraint if exists salary_grades_base_wage_check;
-- Golongan lama tanpa gaji pokok diisi titik tengah skala agar tetap valid.
update salary_grades set base_wage = round((min_wage + max_wage) / 2, 0) where base_wage is null;
alter table salary_grades alter column base_wage set not null;
alter table salary_grades alter column min_wage drop not null;
alter table salary_grades alter column max_wage drop not null;
alter table salary_grades add constraint salary_grades_wage_range_check check (
  (min_wage is null or base_wage >= min_wage)
  and (max_wage is null or base_wage <= max_wage)
  and (min_wage is null or max_wage is null or max_wage >= min_wage)
);
