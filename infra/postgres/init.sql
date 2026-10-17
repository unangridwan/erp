-- Role login untuk aplikasi saat runtime (dev saja). Hak akses tabel diberikan
-- lewat role `app_user` yang dibuat migrasi; role ini tidak bisa melewati RLS.
create role erp_app login password 'erp_app';
