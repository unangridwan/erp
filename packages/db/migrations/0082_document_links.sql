-- Data saling terhubung: dokumen sumber setiap entri jurnal, dibaca dari referensi yang sudah ada (bukan kolom
-- salinan) agar selalu benar dan tidak perlu diisi oleh setiap modul. Dipakai panel "Dokumen terkait" & drilldown
-- laporan. `security_invoker` → RLS tabel asal tetap berlaku untuk pemanggil.

create view account_move_sources with (security_invoker = true) as
  -- Faktur/tagihan dari SO/PO: lewat referensi baris jurnal ke baris pesanan.
  select distinct l.tenant_id, l.move_id, 'sale_order'::text as source_model, so.id as source_id,
      so.name::text as source_name
    from account_move_lines l
    join sale_order_lines sol on sol.id = l.sale_line_id
    join sale_orders so on so.id = sol.order_id
  union all
  select distinct l.tenant_id, l.move_id, 'purchase_order', po.id, po.name
    from account_move_lines l
    join purchase_order_lines pol on pol.id = l.purchase_line_id
    join purchase_orders po on po.id = pol.order_id
  union all
  select tenant_id, move_id, 'payment', id, null from payments where move_id is not null
  union all
  select bsl.tenant_id, bsl.move_id, 'bank_statement', bs.id, bs.name
    from bank_statement_lines bsl join bank_statements bs on bs.id = bsl.statement_id
    where bsl.move_id is not null
  union all
  select d.tenant_id, d.move_id, 'asset', a.id, a.name
    from asset_depreciation_lines d join assets a on a.id = d.asset_id where d.move_id is not null
  union all
  select tenant_id, disposal_move_id, 'asset', id, name from assets where disposal_move_id is not null
  union all
  select tenant_id, move_id, 'fx_revaluation', id, null from fx_revaluations where move_id is not null
  union all
  select tenant_id, reversal_move_id, 'fx_revaluation', id, null from fx_revaluations where reversal_move_id is not null
  union all
  select tenant_id, move_id, 'allocation_run', id, to_char(period, 'YYYY-MM') from allocation_runs where move_id is not null
  union all
  select tenant_id, reversal_move_id, 'allocation_run', id, to_char(period, 'YYYY-MM') from allocation_runs where reversal_move_id is not null
  union all
  select tenant_id, move_id, 'fleet_service', id, null from fleet_services where move_id is not null
  union all
  select tenant_id, account_move_id, 'payroll_run', id, name from payroll_runs where account_move_id is not null
  union all
  select tenant_id, payment_move_id, 'payroll_run', id, name from payroll_runs where payment_move_id is not null
  union all
  select tenant_id, release_move_id, 'payslip', id, null from payslips where release_move_id is not null
  union all
  select tenant_id, disbursement_move_id, 'employee_loan', id, name from employee_loans
    where disbursement_move_id is not null
  union all
  select tenant_id, move_id, 'severance', id, null from severances where move_id is not null
  union all
  select tenant_id, move_id, 'expense_claim', id, name from expense_claims where move_id is not null
  union all
  select tenant_id, account_move_id, 'stock_picking', id, name from stock_pickings where account_move_id is not null
  union all
  -- Lapisan nilai persediaan: dokumen asalnya picking atau order produksi dari mutasi stoknya.
  select distinct v.tenant_id, v.account_move_id,
      case when sm.picking_id is not null then 'stock_picking' else 'production_order' end,
      coalesce(sp.id, po.id), coalesce(sp.name, po.name)
    from stock_valuation_layers v
    join stock_moves sm on sm.id = v.stock_move_id
    left join stock_pickings sp on sp.id = sm.picking_id
    left join production_orders po on po.id = sm.production_order_id
    where v.account_move_id is not null and (sp.id is not null or po.id is not null)
  union all
  select tenant_id, move_id, 'landed_cost', id, name from landed_costs where move_id is not null
  union all
  select tenant_id, reversal_move_id, 'landed_cost', id, name from landed_costs where reversal_move_id is not null
  union all
  select tenant_id, move_id, 'maintenance_request', id, name from maintenance_requests where move_id is not null
  union all
  select tenant_id, parts_move_id, 'maintenance_request', id, name from maintenance_requests
    where parts_move_id is not null
  union all
  select tenant_id, account_move_id, 'production_order', id, name from production_orders
    where account_move_id is not null
  union all
  select tenant_id, scrap_move_id, 'quality_check', id, name from quality_checks where scrap_move_id is not null
  union all
  -- Jurnal turunan dari jurnal lain: pembalikan, penangguhan, pasangan antar perusahaan.
  select m.tenant_id, m.id, 'account_move', s.id, s.name
    from account_moves m join account_moves s on s.id = m.reversed_entry_id
  union all
  select m.tenant_id, m.id, 'account_move', s.id, s.name
    from account_moves m join account_moves s on s.id = m.deferral_source_move_id
  union all
  select m.tenant_id, m.id, 'account_move', s.id, s.name
    from account_moves m join account_moves s on s.id = m.ic_source_move_id;

grant select on account_move_sources to app_user;

-- Indeks pencarian balik (jurnal → dokumen) yang belum ada.
create index if not exists payments_move_idx on payments (move_id) where move_id is not null;
create index if not exists bank_statement_lines_move_idx on bank_statement_lines (move_id) where move_id is not null;
create index if not exists asset_depreciation_lines_move_idx on asset_depreciation_lines (move_id)
  where move_id is not null;
create index if not exists assets_disposal_move_idx on assets (disposal_move_id) where disposal_move_id is not null;
create index if not exists fleet_services_move_idx on fleet_services (move_id) where move_id is not null;
create index if not exists payroll_runs_account_move_idx on payroll_runs (account_move_id)
  where account_move_id is not null;
create index if not exists payroll_runs_payment_move_idx on payroll_runs (payment_move_id)
  where payment_move_id is not null;
create index if not exists payslips_release_move_idx on payslips (release_move_id) where release_move_id is not null;
create index if not exists employee_loans_move_idx on employee_loans (disbursement_move_id)
  where disbursement_move_id is not null;
create index if not exists severances_move_idx on severances (move_id) where move_id is not null;
create index if not exists expense_claims_move_idx on expense_claims (move_id) where move_id is not null;
create index if not exists stock_pickings_account_move_idx on stock_pickings (account_move_id)
  where account_move_id is not null;
create index if not exists stock_valuation_layers_move_idx on stock_valuation_layers (account_move_id)
  where account_move_id is not null;
create index if not exists landed_costs_move_idx on landed_costs (move_id) where move_id is not null;
create index if not exists landed_costs_bill_idx on landed_costs (vendor_bill_id) where vendor_bill_id is not null;
create index if not exists maintenance_requests_move_idx on maintenance_requests (move_id) where move_id is not null;
create index if not exists production_orders_move_idx on production_orders (account_move_id)
  where account_move_id is not null;
create index if not exists account_moves_reversed_idx on account_moves (reversed_entry_id)
  where reversed_entry_id is not null;
create index if not exists account_moves_deferral_source_idx on account_moves (deferral_source_move_id)
  where deferral_source_move_id is not null;
create index if not exists partial_reconciles_debit_idx on partial_reconciles (debit_line_id);
create index if not exists partial_reconciles_credit_idx on partial_reconciles (credit_line_id);
create index if not exists stock_pickings_sale_order_idx on stock_pickings (sale_order_id) where sale_order_id is not null;
create index if not exists stock_pickings_purchase_order_idx on stock_pickings (purchase_order_id)
  where purchase_order_id is not null;
