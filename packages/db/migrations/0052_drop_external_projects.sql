-- Integrasi aplikasi proyek dihapus: proyek, anggota, task, dan timesheet dari aplikasi terhubung tidak lagi disimpan.
-- Aplikasi Terhubung (login OIDC, akun layanan, webhook) tetap ada.
drop table if exists external_timesheets;
drop table if exists external_tasks;
drop table if exists external_project_members;
drop table if exists external_projects;

-- Hak "project.write" tidak lagi dikenal.
delete from role_permissions where permission = 'project.write';
delete from user_permission_overrides where permission = 'project.write';
