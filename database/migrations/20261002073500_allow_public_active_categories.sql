grant select on public.claim_categories to anon;

create policy "categories_select_active_anon" on public.claim_categories
  for select to anon
  using (is_active);
