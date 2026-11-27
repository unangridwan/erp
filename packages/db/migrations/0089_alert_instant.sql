-- Peringatan per dokumen: aturan "dokumen lewat SLA" & "persetujuan tertahan" juga diperiksa seketika saat dokumennya
-- berubah lewat outbox `automation_events`. Catatan pengiriman per dokumen (res_id) mencegah notifikasi ganda: satu per
-- orang per dokumen per aturan per hari; ringkasan harian tetap satu per orang per aturan per hari.

alter table alert_events add column res_id uuid;
alter table alert_events drop constraint alert_events_company_id_rule_key_user_id_day_key;
create unique index alert_events_digest_key on alert_events (company_id, rule_key, user_id, day) where res_id is null;
create unique index alert_events_doc_key on alert_events (company_id, rule_key, user_id, day, res_id)
  where res_id is not null;

-- Event dicatat bila ada aturan otomatis aktif ATAU aturan peringatan seketika aktif untuk model ini.
create or replace function erp_automation_event() returns trigger language plpgsql as $$
declare
  depth integer := coalesce(nullif(current_setting('erp.automation_depth', true), '')::integer, 0);
  kind text := case when tg_op = 'INSERT' then 'created' else 'updated' end;
begin
  if depth > 2 then
    return null;
  end if;
  if not exists (
    select 1 from automation_rules r
    where r.tenant_id = new.tenant_id and r.model = tg_argv[0] and r.active and r.trigger = kind
  ) and not exists (
    select 1 from alert_rules a
    where a.tenant_id = new.tenant_id and a.active and a.owner_id is not null
      and coalesce(a.params ->> 'instant', '1') <> '0'
      and ((a.key = 'flow_late' and tg_argv[0] in ('sale_order', 'purchase_order', 'stock_picking', 'production_order'))
        or (a.key = 'approval_waiting' and tg_argv[0] = 'purchase_order'))
  ) then
    return null;
  end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'updated_at') = (to_jsonb(old) - 'updated_at') then
    return null;
  end if;
  insert into automation_events (tenant_id, company_id, model, res_id, kind, old, new, depth)
  values (new.tenant_id, nullif(to_jsonb(new) ->> 'company_id', '')::uuid, tg_argv[0], new.id, kind,
    case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new), depth);
  return null;
end $$;
