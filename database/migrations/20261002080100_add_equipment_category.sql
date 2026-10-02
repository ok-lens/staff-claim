insert into public.claim_categories (name_en, name_zh, is_active)
values ('Equipment', '设备', true)
on conflict (name_en) do update set name_zh = excluded.name_zh, is_active = true;
