alter table public.profiles add column if not exists email text;
update public.profiles p set email = lower(u.email)
from auth.users u where p.id = u.id and p.email is distinct from lower(u.email);
create unique index if not exists profiles_email_unique on public.profiles (lower(email));

-- Account provisioning and role changes run only through the authenticated admin endpoint.
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own_or_admin on public.profiles;
revoke insert, update, delete on public.profiles from anon, authenticated;

create or replace function app_private.account_ready()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p join auth.users u on u.id = p.id
    where p.id = (select auth.uid()) and p.is_active
      and coalesce(u.raw_app_meta_data ->> 'must_change_password', 'false') <> 'true'
  );
$$;
revoke all on function app_private.account_ready() from public, anon;
grant execute on function app_private.account_ready() to authenticated;

create or replace function app_private.current_profile_role()
returns text language sql stable security definer set search_path = ''
as $$
  select coalesce((select p.role from public.profiles p
    where p.id = (select auth.uid()) and p.is_active
      and app_private.account_ready()), '');
$$;
revoke all on function app_private.current_profile_role() from public, anon;
grant execute on function app_private.current_profile_role() to authenticated;

-- Preserve ownership/reviewer rules, adding a live account check to each claims policy.
do $$
declare p record; statement text;
begin
  for p in select * from pg_policies
    where (schemaname = 'public' and tablename in
      ('claims', 'claim_attachments', 'claim_review_notes', 'claim_audit_logs'))
      or (schemaname = 'storage' and tablename = 'objects'
        and policyname like 'claim_receipts_%')
  loop
    statement := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if p.qual is not null then
      statement := statement || format(' using ((%s) and (select app_private.account_ready()))', p.qual);
    end if;
    if p.with_check is not null then
      statement := statement || format(' with check ((%s) and (select app_private.account_ready()))', p.with_check);
    end if;
    execute statement;
  end loop;
end;
$$;
