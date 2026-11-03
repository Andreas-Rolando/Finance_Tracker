-- =============================================================
-- Finance Tracker — skema awal
-- Jalankan lewat Supabase CLI (`supabase db push`) atau copy-paste
-- ke Supabase Dashboard → SQL Editor → Run.
-- =============================================================

-- ---------- Enum ----------
create type public.category as enum ('income', 'savings', 'bills', 'household', 'debt');
create type public.frequency as enum ('monthly', 'yearly');
create type public.debt_status as enum ('active', 'archived');

-- ---------- Profiles ----------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  created_at  timestamptz not null default now()
);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Hutang ----------
create table public.debts (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name                  text not null check (length(trim(name)) > 0),
  principal             bigint not null check (principal >= 0),          -- total sisa hutang saat mulai dicatat
  monthly_installment   bigint not null default 0 check (monthly_installment >= 0),
  interest_rate_monthly numeric(6, 3) check (interest_rate_monthly >= 0),  -- % per bulan, informasi
  due_day               smallint check (due_day between 1 and 31),
  start_date            date,
  tenor_months          integer check (tenor_months > 0),
  status                public.debt_status not null default 'active',
  created_at            timestamptz not null default now(),
  unique (id, user_id)
);

-- ---------- Target tabungan ----------
create table public.savings_goals (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name            text not null check (length(trim(name)) > 0),
  target_amount   bigint not null check (target_amount > 0),
  initial_amount  bigint not null default 0 check (initial_amount >= 0),
  monthly_plan    bigint not null default 0 check (monthly_plan >= 0),
  target_date     date,
  created_at      timestamptz not null default now(),
  unique (id, user_id)
);

-- ---------- Budget item (rencana) ----------
-- Edit pada item yang sudah berlaku di bulan lalu dibuat sebagai versi baru:
-- versi lama ditutup (effective_to) agar rencana bulan lalu tidak berubah.
create table public.budget_items (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name             text not null check (length(trim(name)) > 0),
  category         public.category not null,
  amount           bigint not null check (amount >= 0),
  frequency        public.frequency not null default 'monthly',
  due_day          smallint check (due_day between 1 and 31),
  due_month        smallint check (due_month between 1 and 12),
  debt_id          uuid,
  savings_goal_id  uuid,
  effective_from   date not null default date_trunc('month', current_date)::date,
  effective_to     date,
  created_at       timestamptz not null default now(),
  unique (id, user_id),
  check (effective_to is null or effective_to >= effective_from),
  check (frequency = 'monthly' or due_month is not null),
  foreign key (debt_id, user_id) references public.debts (id, user_id) on delete set null (debt_id),
  foreign key (savings_goal_id, user_id) references public.savings_goals (id, user_id) on delete set null (savings_goal_id)
);

create index budget_items_user_idx on public.budget_items (user_id);

-- ---------- Transaksi (realisasi) ----------
create table public.transactions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date             date not null default current_date,
  amount           bigint not null check (amount > 0),
  category         public.category not null,
  budget_item_id   uuid,
  debt_id          uuid,
  savings_goal_id  uuid,
  note             text,
  created_at       timestamptz not null default now(),
  foreign key (budget_item_id, user_id) references public.budget_items (id, user_id) on delete set null (budget_item_id),
  foreign key (debt_id, user_id) references public.debts (id, user_id) on delete set null (debt_id),
  foreign key (savings_goal_id, user_id) references public.savings_goals (id, user_id) on delete set null (savings_goal_id)
);

create index transactions_user_date_idx on public.transactions (user_id, date desc);
create index transactions_debt_idx on public.transactions (debt_id) where debt_id is not null;
create index transactions_goal_idx on public.transactions (savings_goal_id) where savings_goal_id is not null;

-- ---------- Pengaturan per bulan ----------
create table public.month_settings (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  year        integer not null,
  month       smallint not null check (month between 1 and 12),
  carry_over  boolean not null default false,
  primary key (user_id, year, month)
);

-- ---------- Goals tahunan ----------
create table public.annual_goals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  year        integer not null,
  title       text not null check (length(trim(title)) > 0),
  is_done     boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ---------- Row Level Security ----------
alter table public.profiles       enable row level security;
alter table public.debts          enable row level security;
alter table public.savings_goals  enable row level security;
alter table public.budget_items   enable row level security;
alter table public.transactions   enable row level security;
alter table public.month_settings enable row level security;
alter table public.annual_goals   enable row level security;

create policy "own profile" on public.profiles
  for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "own rows" on public.debts
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own rows" on public.savings_goals
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own rows" on public.budget_items
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own rows" on public.transactions
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own rows" on public.month_settings
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own rows" on public.annual_goals
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------- Views agregasi (security_invoker → tetap kena RLS) ----------
create view public.v_monthly_actual
with (security_invoker = true) as
select
  extract(year from date)::int   as year,
  extract(month from date)::int  as month,
  category,
  sum(amount)::bigint            as total
from public.transactions
group by 1, 2, 3;

create view public.v_debt_paid
with (security_invoker = true) as
select debt_id, sum(amount)::bigint as paid, count(*)::int as payments, max(date) as last_paid
from public.transactions
where debt_id is not null
group by debt_id;

create view public.v_savings_paid
with (security_invoker = true) as
select savings_goal_id, sum(amount)::bigint as paid
from public.transactions
where savings_goal_id is not null
group by savings_goal_id;
