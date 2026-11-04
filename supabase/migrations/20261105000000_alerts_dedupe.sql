-- =============================================================
-- Peringatan budget, pengaturan ringkasan, & anti-dobel bot Telegram
--  • Pengeluaran Rumah Tangga / Tagihan melewati 80% / 100% rencana
--    bulan itu → antre notifikasi (sekali per level per bulan).
--  • households.budget_alerts_enabled & summaries_enabled.
--  • telegram_updates: update_id yang sudah diproses (dedupe + rate limit).
-- =============================================================

alter table public.households
  add column budget_alerts_enabled boolean not null default true,
  add column summaries_enabled boolean not null default true;

revoke update on public.households from authenticated;
grant update (name, notify_threshold, reminders_enabled, budget_alerts_enabled, summaries_enabled)
  on public.households to authenticated;

-- ---------- Anti-dobel update Telegram ----------
create table public.telegram_updates (
  update_id         bigint primary key,
  telegram_user_id  bigint,
  received_at       timestamptz not null default now()
);
create index telegram_updates_user_time_idx on public.telegram_updates (telegram_user_id, received_at desc);
alter table public.telegram_updates enable row level security;
revoke all on public.telegram_updates from anon, authenticated;

-- ---------- Peringatan budget ----------
create table public.budget_alerts_sent (
  household_id  uuid not null references public.households (id) on delete cascade,
  year          integer not null,
  month         smallint not null,
  category      public.category not null,
  level         smallint not null check (level in (80, 100)),
  sent_at       timestamptz not null default now(),
  primary key (household_id, year, month, category, level)
);
alter table public.budget_alerts_sent enable row level security;
revoke all on public.budget_alerts_sent from anon, authenticated;

alter table public.telegram_outbox drop constraint telegram_outbox_kind_check;
alter table public.telegram_outbox add constraint telegram_outbox_kind_check
  check (kind in ('big_expense', 'budget_alert'));

-- Rencana kategori pada bulan tsb — sama dengan isItemActiveInMonth di web.
create function public.plan_total(p_household uuid, p_category public.category, p_date date)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(b.amount), 0)::bigint
  from public.budget_items b
  where b.household_id = p_household
    and b.category = p_category
    and b.effective_from <= (date_trunc('month', p_date) + interval '1 month - 1 day')::date
    and (b.effective_to is null or b.effective_to >= date_trunc('month', p_date)::date)
    and (b.frequency = 'monthly' or b.due_month = extract(month from p_date))
$$;

revoke execute on function public.plan_total(uuid, public.category, date) from public, anon, authenticated;

create function public.queue_budget_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan bigint;
  actual bigint;
  lvl smallint;
  m_start date := date_trunc('month', new.date)::date;
  inserted boolean;
begin
  if new.category not in ('household', 'bills') then
    return new;
  end if;
  if not exists (select 1 from public.households h where h.id = new.household_id and h.budget_alerts_enabled) then
    return new;
  end if;
  plan := public.plan_total(new.household_id, new.category, new.date);
  if plan <= 0 then
    return new;
  end if;
  select coalesce(sum(t.amount), 0) into actual
  from public.transactions t
  where t.household_id = new.household_id
    and t.category = new.category
    and t.date >= m_start
    and t.date < (m_start + interval '1 month')::date;

  -- Ambil level tertinggi yang baru saja dilewati transaksi ini.
  foreach lvl in array array[100, 80]::smallint[] loop
    if actual * 100 >= plan * lvl and (actual - new.amount) * 100 < plan * lvl then
      insert into public.budget_alerts_sent (household_id, year, month, category, level)
      values (new.household_id, extract(year from m_start), extract(month from m_start), new.category, lvl)
      on conflict do nothing
      returning true into inserted;
      if inserted then
        insert into public.telegram_outbox (household_id, kind, payload)
        values (new.household_id, 'budget_alert', jsonb_build_object(
          'category', new.category, 'level', lvl, 'plan', plan, 'actual', actual,
          'year', extract(year from m_start), 'month', extract(month from m_start),
          'transaction_id', new.id));
      end if;
      exit;
    end if;
  end loop;
  return new;
end;
$$;

revoke execute on function public.queue_budget_alert() from public, anon, authenticated;

create trigger queue_budget_alert
  after insert on public.transactions
  for each row execute function public.queue_budget_alert();
