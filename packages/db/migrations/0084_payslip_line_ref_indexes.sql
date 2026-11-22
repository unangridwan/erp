-- Pelunasan pinjaman, klaim, dan benefit dihitung dari baris slip gaji per referensi (subquery berkorelasi di
-- loan.service.ts dll.). Tanpa indeks, tiap pinjaman memindai seluruh payslip_lines: payroll 5 tahun memakan
-- puluhan detik per hitung slip.
create index payslip_lines_loan_idx on payslip_lines (loan_id) where loan_id is not null;
create index payslip_lines_expense_claim_idx on payslip_lines (expense_claim_id) where expense_claim_id is not null;
create index payslip_lines_benefit_plan_idx on payslip_lines (benefit_plan_id) where benefit_plan_id is not null;
