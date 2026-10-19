-- Item tunda Fase 3: satuan beli/jual dengan konversi, reservasi stok, dan dropship.

-- Satuan bawaan saat menjual/membeli (kosong = satuan produk); harus sekategori dengan satuan produk.
alter table products add column sale_uom_id uuid;
alter table products add column purchase_uom_id uuid;
-- Produk yang biasanya dikirim langsung dari pemasok ke pelanggan.
alter table products add column dropship boolean not null default false;

-- Satuan baris pesanan & rasio ke satuan produk (faktor satuan baris ÷ faktor satuan produk). Kuantitas & harga
-- baris dalam satuan baris; pergerakan stok selalu dalam satuan produk.
alter table sale_order_lines add column uom_id uuid;
alter table sale_order_lines add column uom_ratio numeric(18, 6) not null default 1 check (uom_ratio > 0);
alter table sale_order_lines add column dropship boolean not null default false;
alter table purchase_order_lines add column uom_id uuid;
alter table purchase_order_lines add column uom_ratio numeric(18, 6) not null default 1 check (uom_ratio > 0);
-- Baris PO dropship menunjuk baris SO yang dipenuhinya.
alter table purchase_order_lines add column sale_line_id uuid;
alter table purchase_orders add column dropship_sale_order_id uuid;
alter table account_move_lines add column uom_id uuid;

-- Kuantitas yang dicadangkan dari stok lokasi asal untuk pergerakan yang siap (state ready).
alter table stock_moves add column quantity_reserved numeric(18, 4) not null default 0;
create index stock_moves_reserved_idx on stock_moves (product_id, location_id) where state = 'ready';

-- Transfer dropship: dari lokasi pemasok langsung ke lokasi pelanggan.
alter table stock_pickings drop constraint stock_pickings_picking_type_check;
alter table stock_pickings add constraint stock_pickings_picking_type_check
  check (picking_type in ('incoming', 'outgoing', 'internal', 'dropship'));
