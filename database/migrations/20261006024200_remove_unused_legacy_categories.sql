-- Remove only the nine uncoded legacy categories requested by the user.
-- Referenced categories are retained if a claim is submitted before this migration runs.
delete from public.claim_categories category
where category.accounting_code is null
  and category.name_en in (
    'Courier', 'Equipment', 'Food / Refreshment', 'Office Supplies', 'Others',
    'Repair & Maintenance', 'Stock / Inventory', 'Transport', 'Utilities'
  )
  and not exists (select 1 from public.claims claim where claim.category_id = category.id);
