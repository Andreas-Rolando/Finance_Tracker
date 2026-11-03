-- =============================================================
-- Login SSO (Google) dengan allowlist.
--
-- User baru (termasuk yang pertama kali login via Google) HANYA
-- boleh dibuat kalau:
--   1. emailnya ada di household_invites  → gabung ke household tsb, atau
--   2. belum ada household sama sekali     → jadi admin pertama (bootstrap).
-- Selain itu pembuatan user DITOLAK, jadi akun Google lain tidak bisa
-- masuk walaupun "Allow new users to sign up" aktif.
-- =============================================================

alter table public.profiles add column if not exists avatar_url text;

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
  select * into inv from public.household_invites where email = lower(trim(new.email));

  if not found and exists (select 1 from public.households) then
    raise exception 'Email % belum diundang ke rumah tangga', new.email
      using errcode = '42501';
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

-- Saat akun yang sudah ada login pertama kali dengan Google (identitas
-- di-link otomatis oleh Supabase), lengkapi nama & foto profil.
create function public.sync_profile_from_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles p
  set
    full_name  = coalesce(p.full_name, new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    avatar_url = coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture', p.avatar_url),
    email      = new.email
  where p.id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_updated
  after update of raw_user_meta_data, email on auth.users
  for each row execute function public.sync_profile_from_auth();
