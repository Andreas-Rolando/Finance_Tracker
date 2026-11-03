-- =============================================================
-- Security hardening
--  1. User baru HANYA boleh dibuat lewat Google SSO. Menutup celah
--     daftar email+password memakai email yang sedang diundang.
--  2. "Dicatat oleh" (user_id) tidak bisa dipalsukan.
--  3. Kolom profil & undangan yang sensitif tidak bisa diubah klien.
--  4. Role anon tidak punya akses sama sekali (aplikasi selalu login).
-- =============================================================

-- ---------- 1. SSO-only + allowlist undangan ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.household_invites%rowtype;
  h uuid;
begin
  if coalesce(new.raw_app_meta_data ->> 'provider', '') <> 'google' then
    raise exception 'Akun hanya bisa dibuat lewat login Google' using errcode = '42501';
  end if;

  select * into inv from public.household_invites where email = lower(trim(new.email));

  if not found and exists (select 1 from public.households) then
    raise exception 'Email % belum diundang ke rumah tangga', new.email using errcode = '42501';
  end if;

  insert into public.profiles (id, full_name, email, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.email,
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  on conflict (id) do update set email = excluded.email;

  if inv.email is not null then
    insert into public.household_members (household_id, user_id, role) values (inv.household_id, new.id, 'member');
    delete from public.household_invites where email = inv.email;
  else
    insert into public.households default values returning id into h;
    insert into public.household_members (household_id, user_id, role) values (h, new.id, 'owner');
  end if;
  return new;
end;
$$;

-- ---------- 2. user_id selalu = user yang login ----------
create function public.stamp_author()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.user_id := coalesce(auth.uid(), new.user_id);
  else
    new.user_id := old.user_id;  -- pencatat asli tidak bisa diganti
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['debts', 'savings_goals', 'budget_items', 'transactions', 'month_settings', 'annual_goals'] loop
    execute format(
      'create trigger stamp_author before insert or update on public.%I for each row execute function public.stamp_author()', t);
  end loop;
end;
$$;

-- ---------- 3. Batasi kolom yang boleh diubah klien ----------
-- Profil: hanya nama. Email & foto disinkronkan dari akun Google.
revoke insert, update, delete on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

-- Undangan: invited_by selalu otomatis (default auth.uid()).
revoke insert, update on public.household_invites from authenticated;
grant insert (email, household_id) on public.household_invites to authenticated;

-- Household & keanggotaan: klien tidak boleh menambah/menghapus.
revoke insert, delete on public.households from authenticated;
revoke insert, update, delete on public.household_members from authenticated;

-- ---------- 4. Tutup akses anon ----------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

-- Fungsi internal (trigger) tidak boleh dipanggil lewat RPC.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.sync_profile_from_auth() from public, anon, authenticated;
revoke execute on function public.stamp_author() from public, anon, authenticated;
revoke execute on function public.my_household_id() from public, anon;
grant execute on function public.my_household_id() to authenticated;
