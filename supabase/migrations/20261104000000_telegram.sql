-- =============================================================
-- Integrasi Telegram bot
--  • telegram_accounts : akun Telegram pribadi ↔ user aplikasi
--  • telegram_groups   : grup keluarga ↔ rumah tangga (maks. 1)
--  • telegram_link_codes : kode sekali pakai (10 menit) dari web
--  • telegram_pending  : transaksi yang menunggu pilihan kategori
--  • telegram_outbox   : antrean notifikasi (dikirim oleh cron)
-- Semua tulis dilakukan Edge Function (service role). Klien web hanya
-- boleh membaca status & memutus koneksi.
-- =============================================================

-- ---------- Pengaturan rumah tangga ----------
alter table public.households
  add column notify_threshold bigint not null default 500000 check (notify_threshold >= 0),
  add column reminders_enabled boolean not null default true;

-- ---------- Asal transaksi ----------
alter table public.transactions
  add column source text not null default 'app' check (source in ('app', 'telegram')),
  add column telegram_chat_id bigint;

-- ---------- Tabel Telegram ----------
create table public.telegram_accounts (
  user_id           uuid primary key references public.profiles (id) on delete cascade,
  household_id      uuid not null references public.households (id) on delete cascade,
  telegram_user_id  bigint not null unique,
  chat_id           bigint not null,
  username          text,
  first_name        text,
  linked_at         timestamptz not null default now()
);

create table public.telegram_groups (
  chat_id       bigint primary key,
  household_id  uuid not null unique references public.households (id) on delete cascade,
  title         text,
  linked_by     uuid references public.profiles (id) on delete set null,
  linked_at     timestamptz not null default now()
);

create table public.telegram_link_codes (
  code          text primary key,
  kind          text not null check (kind in ('account', 'group')),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  household_id  uuid not null references public.households (id) on delete cascade,
  expires_at    timestamptz not null default now() + interval '10 minutes'
);

create table public.telegram_pending (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households (id) on delete cascade,
  user_id           uuid not null references public.profiles (id) on delete cascade,
  chat_id           bigint not null,
  payload           jsonb not null,
  created_at        timestamptz not null default now()
);

create table public.telegram_outbox (
  id            bigint generated always as identity primary key,
  household_id  uuid not null references public.households (id) on delete cascade,
  kind          text not null check (kind in ('big_expense')),
  payload       jsonb not null,
  attempts      smallint not null default 0,
  last_error    text,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz
);

create index telegram_outbox_unsent_idx on public.telegram_outbox (created_at) where sent_at is null;

-- ---------- RLS ----------
alter table public.telegram_accounts   enable row level security;
alter table public.telegram_groups     enable row level security;
alter table public.telegram_link_codes enable row level security;
alter table public.telegram_pending    enable row level security;
alter table public.telegram_outbox     enable row level security;

-- Anggota bisa melihat siapa saja yang terhubung & grupnya.
create policy "household telegram accounts" on public.telegram_accounts
  for select to authenticated using (household_id = (select public.my_household_id()));
create policy "unlink own telegram" on public.telegram_accounts
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "household telegram group" on public.telegram_groups
  for select to authenticated using (household_id = (select public.my_household_id()));
create policy "unlink household group" on public.telegram_groups
  for delete to authenticated using (household_id = (select public.my_household_id()));

-- link_codes, pending, outbox: tanpa policy → hanya service role.

revoke all on public.telegram_accounts, public.telegram_groups, public.telegram_link_codes,
  public.telegram_pending, public.telegram_outbox from anon, authenticated;
grant select, delete on public.telegram_accounts, public.telegram_groups to authenticated;

-- Pengaturan notifikasi boleh diubah anggota (kolom lain tetap dikunci).
revoke update on public.households from authenticated;
grant update (name, notify_threshold, reminders_enabled) on public.households to authenticated;

-- Kolom asal transaksi hanya diisi Edge Function.
revoke insert, update on public.transactions from authenticated;
grant insert (date, amount, category, budget_item_id, debt_id, savings_goal_id, note)
  on public.transactions to authenticated;
grant update (date, amount, category, budget_item_id, debt_id, savings_goal_id, note)
  on public.transactions to authenticated;

-- ---------- RPC: kode linking ----------
create function public.create_telegram_link_code(p_kind text)
returns table (code text, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  hid uuid := public.my_household_id();
  c text;
begin
  if auth.uid() is null or hid is null then
    raise exception 'Harus login' using errcode = '42501';
  end if;
  if p_kind not in ('account', 'group') then
    raise exception 'Jenis kode tidak valid' using errcode = '22023';
  end if;
  delete from public.telegram_link_codes l
  where (l.user_id = auth.uid() and l.kind = p_kind) or l.expires_at < now();
  c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  return query
    insert into public.telegram_link_codes as l (code, kind, user_id, household_id)
    values (c, p_kind, auth.uid(), hid)
    returning l.code, l.expires_at;
end;
$$;

revoke execute on function public.create_telegram_link_code(text) from public, anon;
grant execute on function public.create_telegram_link_code(text) to authenticated;

-- ---------- Trigger: antrekan notifikasi pengeluaran besar ----------
create function public.queue_big_expense()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.telegram_groups%rowtype;
  threshold bigint;
begin
  if new.category = 'income' then
    return new;
  end if;
  select * into g from public.telegram_groups where household_id = new.household_id;
  if not found or new.telegram_chat_id is not distinct from g.chat_id then
    return new;  -- tidak ada grup, atau dicatat langsung di grup (sudah terlihat)
  end if;
  select notify_threshold into threshold from public.households where id = new.household_id;
  if threshold is null or threshold = 0 or new.amount < threshold then
    return new;
  end if;
  insert into public.telegram_outbox (household_id, kind, payload)
  values (new.household_id, 'big_expense', jsonb_build_object('transaction_id', new.id));
  return new;
end;
$$;

revoke execute on function public.queue_big_expense() from public, anon, authenticated;

create trigger queue_big_expense
  after insert on public.transactions
  for each row execute function public.queue_big_expense();
