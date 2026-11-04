-- =============================================================
-- Jadwal Telegram (pg_cron + pg_net)
--  • Setiap menit : kirim antrean notifikasi (telegram_outbox), hanya
--                   memanggil Edge Function kalau ada yang belum terkirim.
--  • 00:00 UTC    : pengingat jatuh tempo harian (= 07:00 WIB).
--
-- URL & secret dibaca dari Supabase Vault saat job berjalan. Buat sekali
-- lewat SQL Editor (JANGAN commit nilainya):
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/telegram-cron', 'telegram_cron_url');
--   select vault.create_secret('<TELEGRAM_CRON_SECRET>', 'telegram_cron_secret');
-- =============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function public.call_telegram_cron(task text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  fn_url text;
  secret text;
begin
  select decrypted_secret into fn_url from vault.decrypted_secrets where name = 'telegram_cron_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'telegram_cron_secret';
  if fn_url is null or secret is null then
    raise warning 'telegram cron: secret vault belum dibuat';
    return;
  end if;
  perform net.http_post(
    url := fn_url || '?task=' || task,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
end;
$$;

revoke execute on function public.call_telegram_cron(text) from public, anon, authenticated;

select cron.schedule(
  'telegram-outbox',
  '* * * * *',
  $$ select public.call_telegram_cron('outbox')
     where exists (select 1 from public.telegram_outbox where sent_at is null and attempts < 5) $$
);

select cron.schedule(
  'telegram-reminders',
  '0 0 * * *',
  $$ select public.call_telegram_cron('reminders') $$
);
