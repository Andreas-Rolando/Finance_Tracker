-- =============================================================
-- Ringkasan terjadwal + Realtime (khusus Supabase)
--  • Minggu 13:00 UTC (= 20:00 WIB)    : ringkasan mingguan
--  • Tanggal 1, 01:00 UTC (= 08:00 WIB): ringkasan bulan lalu
--  • Realtime: web ter-update otomatis saat ada perubahan data
-- Butuh migrasi 20261104010000_telegram_cron.sql (call_telegram_cron).
-- =============================================================

select cron.schedule(
  'telegram-weekly-summary',
  '0 13 * * 0',
  $$ select public.call_telegram_cron('weekly') $$
);

select cron.schedule(
  'telegram-monthly-summary',
  '0 1 1 * *',
  $$ select public.call_telegram_cron('monthly') $$
);

-- Realtime menghormati RLS: tiap user hanya menerima perubahan milik rumah tangganya.
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['transactions', 'budget_items', 'debts', 'savings_goals', 'month_settings'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;
