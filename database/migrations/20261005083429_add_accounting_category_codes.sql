alter table public.claim_categories
  add column if not exists accounting_code text
  constraint claim_categories_accounting_code_format
  check (accounting_code is null or accounting_code ~ '^[0-9]{3}-[0-9]{4}$');

create unique index if not exists claim_categories_accounting_code_key
  on public.claim_categories (accounting_code)
  where accounting_code is not null;

-- Ledger codes supplied by the accountant. Existing categories and claim links are retained.
insert into public.claim_categories (name_en, name_zh, accounting_code) values
  ('Entertainment', '招待费', '912-0000'),
  ('Fixed asset', '固定资产', '200-3000'),
  ('General Expenses', '一般费用', '915-0000'),
  ('Office Refreshment', '办公茶点', '911-0000'),
  ('Office rental', '办公室租金', '914-0000'),
  ('Petrol', '汽油', '908-0000'),
  ('Printing & stationery', '印刷及文具', '910-0000'),
  ('Telephone & Internet charges', '电话及网络费', '909-0000'),
  ('Toll & Parking', '过路费及停车费', '905-0000'),
  ('Upkeep of office', '办公室维护', '916-0000'),
  ('Water & electricity', '水电费', '907-0000'),
  ('Employee medical benefits', '员工医疗福利', '919-0000'),
  ('Upkeep of motor vehicle', '车辆维护', '906-0000'),
  ('Travel cost', '差旅费', '925-0000')
on conflict (name_en) do update set
  name_zh = excluded.name_zh,
  accounting_code = excluded.accounting_code;
