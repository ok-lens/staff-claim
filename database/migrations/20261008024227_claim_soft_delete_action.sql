create or replace function public.soft_delete_claim(p_claim_id uuid)
returns uuid language plpgsql security invoker set search_path = public
as $$
declare removed_id uuid;
begin
  update public.claims set deleted_at = now(), updated_at = now()
  where id = p_claim_id and deleted_at is null and status <> 'PAID'
    and app_private.account_ready()
    and (app_private.can_manage_claims() or
      (claimant_id = auth.uid() and status in ('SUBMITTED','NEED_REVIEW')))
  returning id into removed_id;
  if removed_id is null then raise exception 'Claim unavailable or deletion not permitted'; end if;
  insert into public.claim_audit_logs(claim_id,actor_id,action,details)
  values (removed_id,auth.uid(),'Claim deleted / 已删除报销','{"soft_delete":true}'::jsonb);
  return removed_id;
end;
$$;
revoke all on function public.soft_delete_claim(uuid) from public, anon;
grant execute on function public.soft_delete_claim(uuid) to authenticated;
