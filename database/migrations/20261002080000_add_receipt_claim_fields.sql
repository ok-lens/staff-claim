alter table public.claims
  add column if not exists currency text not null default 'MYR',
  add column if not exists receipt_number text,
  add column if not exists receipt_total numeric(12,2) check (receipt_total is null or receipt_total >= 0),
  add column if not exists duplicate_claim_id uuid references public.claims(id) on delete set null;

alter table public.claim_attachments
  add column if not exists file_size bigint,
  add column if not exists file_hash text;

create index if not exists claims_claimant_submitted_idx on public.claims (claimant_id, submitted_at desc);
create index if not exists claims_status_submitted_idx on public.claims (status, submitted_at desc);
create index if not exists claim_attachments_claim_id_idx on public.claim_attachments (claim_id);
