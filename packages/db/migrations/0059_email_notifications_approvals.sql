-- Notifikasi juga dikirim lewat email (outbox: dikirim job setelah transaksi selesai) + preferensi per pengguna.
alter table users add column notify_email boolean not null default true;
alter table notifications
  add column email_state text check (email_state in ('pending', 'sent', 'failed', 'skipped')),
  add column email_attempts smallint not null default 0,
  add column emailed_at timestamptz;
create index notifications_email_pending_idx on notifications (created_at) where email_state = 'pending';

-- Persetujuan opsional (per perusahaan) sebelum payroll run diposting, mutasi/promosi diterapkan, dan penawaran kerja
-- dikirim. Bawaan nonaktif: perilaku lama tetap.
alter table payroll_settings
  add column payroll_run_approval boolean not null default false,
  add column movement_approval boolean not null default false,
  add column job_offer_approval boolean not null default false;

alter table payroll_runs add column approval_request_id uuid;
alter table payroll_runs add foreign key (tenant_id, approval_request_id)
  references approval_requests (tenant_id, id) on delete set null (approval_request_id);
alter table employee_movements add column approval_request_id uuid;
alter table employee_movements add foreign key (tenant_id, approval_request_id)
  references approval_requests (tenant_id, id) on delete set null (approval_request_id);
alter table job_offers add column approval_request_id uuid;
alter table job_offers add foreign key (tenant_id, approval_request_id)
  references approval_requests (tenant_id, id) on delete set null (approval_request_id);
