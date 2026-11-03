-- =============================================================
-- Household: data dipakai bersama oleh anggota rumah tangga
-- (mis. suami & istri). Akun dibuat admin lewat Supabase Dashboard.
--
-- • User pertama otomatis membuat rumah tangga (owner).
-- • User berikutnya hanya bergabung kalau emailnya sudah DIUNDANG
--   (household_invites) — kalau tidak, ia mendapat rumah tangga
--   sendiri yang terpisah & tidak bisa melihat data kamu.
-- • Kolom user_id di tabel data tetap ada = "dicatat oleh".
-- =============================================================

-- ---------- Tabel household ----------
create table public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Rumah Tangga',
  created_at  timestamptz not null default now()
);

alter table public.profiles add column if not exists email text;

create table public.household_members (
  household_id  uuid not null references public.households (id) on delete cascade,
  user_id       uuid not null unique references public.profiles (id) on delete cascade,  -- 1 user = 1 household
  role          text not null default 'member' check (role in ('owner', 'member')),
  created_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table public.household_invites (
  email         text primary key check (email = lower(trim(email)) and position('@' in email) > 1),
  household_id  uuid not null references public.households (id) on delete cascade,
  invited_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);

-- Household milik user yang sedang login. SECURITY DEFINER supaya tidak
-- rekursif terhadap RLS household_members.
create function public.my_household_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select household_id from public.household_members where user_id = auth.uid() limit 1
$$;

grant execute on function public.my_household_id() to authenticated;

-- ---------- Backfill user yang sudah ada ----------
insert into public.profiles (id, email, full_name)
select u.id, u.email, u.raw_user_meta_data ->> 'full_name'
from auth.users u
on conflict (id) do update set email = excluded.email;

do $$
declare
  u record;
  h uuid;
begin
  for u in select id from auth.users order by created_at loop
    if not exists (select 1 from public.household_members m where m.user_id = u.id) then
      insert into public.households default values returning id into h;
      insert into public.household_members (household_id, user_id, role) values (h, u.id, 'owner');
    end if;
  end loop;
end;
$$;

-- ---------- household_id di semua tabel data ----------
do $$
declare
  t text;
begin
  foreach t in array array['debts', 'savings_goals', 'budget_items', 'transactions', 'month_settings', 'annual_goals'] loop
    execute format('alter table public.%I add column household_id uuid references public.households (id) on delete cascade', t);
    execute format(
      'update public.%I x set household_id = m.household_id from public.household_members m where m.user_id = x.user_id', t);
    execute format('alter table public.%I alter column household_id set not null', t);
    execute format('alter table public.%I alter column household_id set default public.my_household_id()', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "household rows" on public.%I for all to authenticated '
      'using (household_id = (select public.my_household_id())) '
      'with check (household_id = (select public.my_household_id()))', t);
  end loop;
end;
$$;

-- user_id (pencatat) boleh kosong kalau anggota dihapus
alter table public.debts          alter column user_id drop not null;
alter table public.savings_goals  alter column user_id drop not null;
alter table public.budget_items   alter column user_id drop not null;
alter table public.transactions   alter column user_id drop not null;
alter table public.annual_goals   alter column user_id drop not null;

-- month_settings: satu baris per household per bulan
alter table public.month_settings drop constraint month_settings_pkey;
alter table public.month_settings alter column user_id drop not null;
alter table public.month_settings add primary key (household_id, year, month);

-- Relasi antar data: anggota household boleh saling menautkan
-- (mis. istri bayar hutang yang dicatat suami), tapi tidak lintas household.
alter table public.budget_items drop constraint budget_items_debt_id_user_id_fkey;
alter table public.budget_items drop constraint budget_items_savings_goal_id_user_id_fkey;
alter table public.transactions drop constraint transactions_budget_item_id_user_id_fkey;
alter table public.transactions drop constraint transactions_debt_id_user_id_fkey;
alter table public.transactions drop constraint transactions_savings_goal_id_user_id_fkey;
alter table public.debts         drop constraint debts_id_user_id_key;
alter table public.savings_goals drop constraint savings_goals_id_user_id_key;
alter table public.budget_items  drop constraint budget_items_id_user_id_key;

alter table public.debts         add unique (id, household_id);
alter table public.savings_goals add unique (id, household_id);
alter table public.budget_items  add unique (id, household_id);

alter table public.budget_items
  add foreign key (debt_id, household_id) references public.debts (id, household_id) on delete set null (debt_id),
  add foreign key (savings_goal_id, household_id) references public.savings_goals (id, household_id) on delete set null (savings_goal_id);
alter table public.transactions
  add foreign key (budget_item_id, household_id) references public.budget_items (id, household_id) on delete set null (budget_item_id),
  add foreign key (debt_id, household_id) references public.debts (id, household_id) on delete set null (debt_id),
  add foreign key (savings_goal_id, household_id) references public.savings_goals (id, household_id) on delete set null (savings_goal_id);

alter table public.debts         drop constraint debts_user_id_fkey,
  add foreign key (user_id) references auth.users (id) on delete set null;
alter table public.savings_goals drop constraint savings_goals_user_id_fkey,
  add foreign key (user_id) references auth.users (id) on delete set null;
alter table public.budget_items  drop constraint budget_items_user_id_fkey,
  add foreign key (user_id) references auth.users (id) on delete set null;
alter table public.transactions  drop constraint transactions_user_id_fkey,
  add foreign key (user_id) references auth.users (id) on delete set null;
alter table public.month_settings drop constraint month_settings_user_id_fkey,
  add foreign key (user_id) references auth.users (id) on delete set null;
alter table public.annual_goals  drop constraint annual_goals_user_id_fkey,
  add foreign key (user_id) references auth.users (id) on delete set null;

drop index if exists public.transactions_user_date_idx;
create index transactions_household_date_idx on public.transactions (household_id, date desc);
create index budget_items_household_idx on public.budget_items (household_id);

-- ---------- RLS tabel household ----------
alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;

create policy "my household" on public.households
  for select to authenticated using (id = (select public.my_household_id()));
create policy "rename my household" on public.households
  for update to authenticated
  using (id = (select public.my_household_id())) with check (id = (select public.my_household_id()));

create policy "my household members" on public.household_members
  for select to authenticated using (household_id = (select public.my_household_id()));

create policy "my household invites" on public.household_invites
  for all to authenticated
  using (household_id = (select public.my_household_id()))
  with check (household_id = (select public.my_household_id()));

-- Profil: boleh lihat sesama anggota household, hanya ubah milik sendiri.
drop policy "own profile" on public.profiles;
create policy "read household profiles" on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or id in (select user_id from public.household_members where household_id = (select public.my_household_id()))
  );
create policy "update own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ---------- User baru: gabung via undangan, atau buat household sendiri ----------
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
  insert into public.profiles (id, full_name, email)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.email)
  on conflict (id) do update set email = excluded.email;

  select * into inv from public.household_invites where email = lower(trim(new.email));
  if found then
    insert into public.household_members (household_id, user_id, role) values (inv.household_id, new.id, 'member');
    delete from public.household_invites where email = inv.email;
  else
    insert into public.households default values returning id into h;
    insert into public.household_members (household_id, user_id, role) values (h, new.id, 'owner');
  end if;
  return new;
end;
$$;
