create schema if not exists app_private;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null default 'staff' check (role in ('staff', 'accountant', 'admin', 'boss')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.claim_categories (
  id uuid primary key default gen_random_uuid(),
  name_en text not null,
  name_zh text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (name_en)
);

create table if not exists public.claims (
  id uuid primary key default gen_random_uuid(),
  claim_number text unique not null,
  claimant_id uuid not null references public.profiles(id) on delete restrict,
  category_id uuid references public.claim_categories(id),
  merchant text,
  purchase_date date not null,
  amount numeric(12,2) not null check (amount >= 0),
  approved_amount numeric(12,2) check (approved_amount is null or approved_amount >= 0),
  purpose text,
  remarks text,
  status text not null default 'SUBMITTED' check (status in ('DRAFT', 'SUBMITTED', 'NEED_REVIEW', 'APPROVED', 'REJECTED', 'PAID')),
  duplicate_flag boolean not null default false,
  duplicate_message text,
  payment_reference text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.claim_attachments (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  attachment_type text not null check (attachment_type in ('RECEIPT', 'PURCHASE_PROOF', 'OTHER')),
  storage_bucket text not null default 'claim-receipts',
  storage_path text not null,
  file_name text,
  mime_type text,
  created_at timestamptz not null default now()
);

create table if not exists public.claim_review_notes (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  note text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.claim_audit_logs (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid references public.claims(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function app_private.current_profile_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select role from public.profiles where id = (select auth.uid()) and is_active), 'staff')
$$;

create or replace function app_private.can_manage_claims()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select app_private.current_profile_role() in ('accountant', 'admin', 'boss')
$$;

revoke all on schema app_private from public;
grant usage on schema app_private to authenticated;
revoke all on function app_private.current_profile_role() from public;
revoke all on function app_private.can_manage_claims() from public;
grant execute on function app_private.current_profile_role() to authenticated;
grant execute on function app_private.can_manage_claims() to authenticated;

alter table public.profiles enable row level security;
alter table public.claim_categories enable row level security;
alter table public.claims enable row level security;
alter table public.claim_attachments enable row level security;
alter table public.claim_review_notes enable row level security;
alter table public.claim_audit_logs enable row level security;

create policy "profiles_select_own_or_manager" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or app_private.can_manage_claims());

create policy "profiles_insert_own" on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()));

create policy "profiles_update_own_or_admin" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) or app_private.current_profile_role() in ('admin', 'boss'))
  with check (id = (select auth.uid()) or app_private.current_profile_role() in ('admin', 'boss'));

create policy "categories_select_active_or_manager" on public.claim_categories
  for select to authenticated
  using (is_active or app_private.can_manage_claims());

create policy "categories_manage_admin" on public.claim_categories
  for all to authenticated
  using (app_private.current_profile_role() in ('admin', 'boss'))
  with check (app_private.current_profile_role() in ('admin', 'boss'));

create policy "claims_select_own_or_manager" on public.claims
  for select to authenticated
  using (claimant_id = (select auth.uid()) or app_private.can_manage_claims());

create policy "claims_insert_own" on public.claims
  for insert to authenticated
  with check (claimant_id = (select auth.uid()));

create policy "claims_update_own_or_manager" on public.claims
  for update to authenticated
  using (claimant_id = (select auth.uid()) or app_private.can_manage_claims())
  with check (claimant_id = (select auth.uid()) or app_private.can_manage_claims());

create policy "attachments_select_related" on public.claim_attachments
  for select to authenticated
  using (
    exists (
      select 1 from public.claims c
      where c.id = claim_id
      and (c.claimant_id = (select auth.uid()) or app_private.can_manage_claims())
    )
  );

create policy "attachments_insert_own_claim" on public.claim_attachments
  for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and exists (
      select 1 from public.claims c
      where c.id = claim_id
      and c.claimant_id = (select auth.uid())
    )
  );

create policy "review_notes_select_related" on public.claim_review_notes
  for select to authenticated
  using (
    exists (
      select 1 from public.claims c
      where c.id = claim_id
      and (c.claimant_id = (select auth.uid()) or app_private.can_manage_claims())
    )
  );

create policy "review_notes_insert_manager" on public.claim_review_notes
  for insert to authenticated
  with check (actor_id = (select auth.uid()) and app_private.can_manage_claims());

create policy "audit_select_related" on public.claim_audit_logs
  for select to authenticated
  using (
    claim_id is null
    or exists (
      select 1 from public.claims c
      where c.id = claim_id
      and (c.claimant_id = (select auth.uid()) or app_private.can_manage_claims())
    )
  );

create policy "audit_insert_authenticated" on public.claim_audit_logs
  for insert to authenticated
  with check (actor_id = (select auth.uid()) or actor_id is null);

grant select, insert, update on public.profiles to authenticated;
grant select on public.claim_categories to authenticated;
grant insert, update, delete on public.claim_categories to authenticated;
grant select, insert, update on public.claims to authenticated;
grant select, insert on public.claim_attachments to authenticated;
grant select, insert on public.claim_review_notes to authenticated;
grant select, insert on public.claim_audit_logs to authenticated;

insert into public.claim_categories (name_en, name_zh) values
  ('Office Supplies', '办公用品'),
  ('Stock / Inventory', '库存'),
  ('Repair & Maintenance', '维修保养'),
  ('Transport', '交通'),
  ('Petrol', '汽油'),
  ('Courier', '快递'),
  ('Food / Refreshment', '餐饮茶点'),
  ('Utilities', '水电杂费'),
  ('Others', '其他')
on conflict (name_en) do update set name_zh = excluded.name_zh, is_active = true;

insert into storage.buckets (id, name, public)
values ('claim-receipts', 'claim-receipts', false)
on conflict (id) do update set public = false;

create policy "claim_receipts_select_own_or_manager" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'claim-receipts'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or app_private.can_manage_claims()
    )
  );

create policy "claim_receipts_insert_own_folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'claim-receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "claim_receipts_update_own_or_manager" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'claim-receipts'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or app_private.can_manage_claims()
    )
  )
  with check (
    bucket_id = 'claim-receipts'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or app_private.can_manage_claims()
    )
  );

create policy "claim_receipts_delete_own_or_manager" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'claim-receipts'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or app_private.can_manage_claims()
    )
  );
