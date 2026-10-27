-- Langganan gratis yang diberikan admin platform: complimentary_until null = tanpa batas waktu.
alter table subscriptions
  add column complimentary boolean not null default false,
  add column complimentary_until timestamptz,
  add column complimentary_note text check (char_length(complimentary_note) <= 300),
  add column complimentary_by uuid references users(id) on delete set null;
