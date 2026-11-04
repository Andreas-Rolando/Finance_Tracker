// Test keamanan & logika database: semua migrasi dijalankan di PGlite (Postgres WASM)
// dengan stub schema `auth` dan grant default ala Supabase. Jalan di `npm test`.
import fs from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

const MIGRATIONS = path.resolve(import.meta.dirname, '../../supabase/migrations')
/** Migrasi yang butuh pg_cron/pg_net/vault/realtime → tidak bisa di PGlite. */
const SUPABASE_ONLY = ['20261104010000_telegram_cron.sql', '20261105010000_summaries_realtime.sql']

const GOOGLE = '{"provider":"google","providers":["google"]}'
const EMAIL = '{"provider":"email","providers":["email"]}'

type Role = 'anon' | 'authenticated' | 'service_role'

async function freshDb() {
  const db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}',
      raw_app_meta_data jsonb default '{}', created_at timestamptz default now());
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `)
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql') && !SUPABASE_ONLY.includes(f)).sort()
  for (const f of files) await db.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'))

  const as = async <T = Record<string, unknown>>(role: Role, uid: string | null, sql: string, params?: unknown[]) => {
    await db.exec(`set role ${role}; select set_config('request.jwt.sub', '${uid ?? ''}', false);`)
    try {
      return (await db.query<T>(sql, params)).rows
    } finally {
      await db.exec('reset role')
    }
  }
  const addUser = (id: string, email: string, provider = GOOGLE, name?: string) =>
    db.query(`insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values ($1, $2, $3, $4)`, [
      id, email, JSON.stringify(name ? { name } : {}), provider,
    ])
  const householdOf = async (uid: string) =>
    (await db.query<{ household_id: string }>(`select household_id from household_members where user_id = $1`, [uid])).rows[0]?.household_id
  return { db, as, addUser, householdOf }
}

const uid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const SUAMI = uid(1), ISTRI = uid(2), ASING = uid(3)

// ------------------------------------------------------------------ akun & rumah tangga

describe('akun: SSO Google + undangan', () => {
  let t: Awaited<ReturnType<typeof freshDb>>
  beforeAll(async () => {
    t = await freshDb()
  })

  it('pendaftaran email/password ditolak, bahkan untuk user pertama', async () => {
    await expect(t.addUser(ASING, 'x@x.com', EMAIL)).rejects.toThrow(/Google/)
  })

  it('user Google pertama menjadi owner rumah tangga baru, nama & foto dari Google', async () => {
    await t.db.query(`insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values ($1, $2, $3, $4)`, [
      SUAMI, 'suami@gmail.com', JSON.stringify({ name: 'Nando', picture: 'https://x/p.png' }), GOOGLE,
    ])
    const [p] = (await t.db.query<{ full_name: string; avatar_url: string; role: string }>(
      `select p.full_name, p.avatar_url, m.role from profiles p join household_members m on m.user_id = p.id where p.id = $1`, [SUAMI],
    )).rows
    expect(p).toEqual({ full_name: 'Nando', avatar_url: 'https://x/p.png', role: 'owner' })
  })

  it('akun Google yang tidak diundang ditolak', async () => {
    await expect(t.addUser(ASING, 'asing@gmail.com')).rejects.toThrow(/belum diundang/)
  })

  it('daftar email/password memakai email yang diundang ditolak, undangan tidak hangus', async () => {
    await t.as('authenticated', SUAMI, `insert into household_invites (email, household_id) values ('istri@gmail.com', my_household_id())`)
    await expect(t.addUser(ASING, 'istri@gmail.com', EMAIL)).rejects.toThrow(/Google/)
    expect((await t.db.query(`select 1 from household_invites`)).rows).toHaveLength(1)
  })

  it('istri yang diundang bergabung via Google; undangan terpakai', async () => {
    await t.addUser(ISTRI, 'Istri@gmail.com', GOOGLE, 'Istri')
    expect(await t.householdOf(ISTRI)).toBe(await t.householdOf(SUAMI))
    expect((await t.db.query(`select 1 from household_invites`)).rows).toHaveLength(0)
  })

  it('hak kolom profil & undangan', async () => {
    expect(await t.as('authenticated', ISTRI, `update profiles set full_name = 'Sayang' where id = $1 returning full_name`, [ISTRI])).toEqual([{ full_name: 'Sayang' }])
    await expect(t.as('authenticated', ISTRI, `update profiles set email = 'x@x.com' where id = $1`, [ISTRI])).rejects.toThrow(/permission/)
    await expect(t.as('authenticated', ISTRI, `update profiles set full_name = 'hack' where id = $1 returning id`, [SUAMI])).resolves.toEqual([])
    await expect(t.as('authenticated', ISTRI, `insert into household_invites (email, household_id, invited_by) values ('a@b.co', my_household_id(), $1)`, [SUAMI])).rejects.toThrow(/permission/)
    await expect(t.as('authenticated', ISTRI, `insert into household_members (household_id, user_id) values (my_household_id(), $1)`, [ISTRI])).rejects.toThrow(/permission/)
    await expect(t.as('authenticated', ISTRI, `update household_members set role = 'owner' where user_id = $1`, [ISTRI])).rejects.toThrow(/permission/)
  })
})

// ------------------------------------------------------------------ data bersama & isolasi

describe('data rumah tangga: berbagi & isolasi', () => {
  let t: Awaited<ReturnType<typeof freshDb>>
  let debtId: string
  beforeAll(async () => {
    t = await freshDb()
    await t.addUser(SUAMI, 'suami@gmail.com')
    await t.as('authenticated', SUAMI, `insert into household_invites (email, household_id) values ('istri@gmail.com', my_household_id())`)
    await t.addUser(ISTRI, 'istri@gmail.com')
    // Orang luar mendapat rumah tangga sendiri hanya kalau bootstrap; simulasikan rumah tangga lain via service role.
    await t.db.exec(`insert into auth.users (id, email) select '${ASING}', 'asing@x.com' where false`)
    ;[{ id: debtId }] = await t.as<{ id: string }>('authenticated', SUAMI, `insert into debts (name, principal, monthly_installment, user_id) values ('KTA', 1000, 100, $1) returning id`, [ISTRI])
  })

  it('pencatat (user_id) selalu user yang login, tidak bisa dipalsukan / diganti', async () => {
    expect((await t.as<{ user_id: string }>('authenticated', SUAMI, `select user_id from debts`))[0].user_id).toBe(SUAMI)
    await t.as('authenticated', ISTRI, `update debts set user_id = $1, name = 'KTA2' where id = $2`, [ISTRI, debtId])
    expect((await t.as<{ user_id: string; name: string }>('authenticated', ISTRI, `select user_id, name from debts`))[0]).toEqual({ user_id: SUAMI, name: 'KTA2' })
  })

  it('istri bisa membayar hutang yang dicatat suami; view ikut terisi', async () => {
    await t.as('authenticated', ISTRI, `insert into transactions (amount, category, debt_id) values (100, 'debt', $1)`, [debtId])
    expect(Number((await t.as<{ paid: number }>('authenticated', SUAMI, `select paid from v_debt_paid`))[0].paid)).toBe(100)
  })

  it('kolom asal transaksi tidak bisa diisi dari web', async () => {
    await expect(t.as('authenticated', ISTRI, `insert into transactions (amount, category, source) values (1, 'bills', 'telegram')`)).rejects.toThrow(/permission/)
  })

  it('rumah tangga lain tidak bisa melihat / menautkan data', async () => {
    const other = await t.as<{ id: string }>('service_role', null, `insert into households default values returning id`)
    await t.db.exec(`alter table auth.users disable trigger on_auth_user_created`)
    await t.db.query(`insert into auth.users (id, email) values ($1, 'asing@x.com')`, [ASING])
    await t.db.exec(`alter table auth.users enable trigger on_auth_user_created`)
    await t.db.query(`insert into profiles (id, email) values ($1, 'asing@x.com')`, [ASING])
    await t.db.query(`insert into household_members (household_id, user_id, role) values ($1, $2, 'owner')`, [other[0].id, ASING])
    const seen = await t.as<{ d: number; t: number; p: number }>('authenticated', ASING,
      `select (select count(*) from debts)::int d, (select count(*) from transactions)::int t, (select count(*) from profiles)::int p`)
    expect(seen[0]).toEqual({ d: 0, t: 0, p: 1 })
    await expect(t.as('authenticated', ASING, `insert into transactions (amount, category, debt_id) values (1, 'debt', $1)`, [debtId])).rejects.toThrow()
    await expect(t.as('authenticated', ASING, `insert into household_invites (email, household_id) values ('evil@x.com', $1)`, [await t.householdOf(SUAMI)])).rejects.toThrow()
  })

  it('anon tidak punya akses sama sekali', async () => {
    for (const tbl of ['debts', 'transactions', 'profiles', 'households', 'telegram_accounts', 'v_monthly_actual']) {
      await expect(t.as('anon', null, `select * from ${tbl} limit 1`)).rejects.toThrow(/permission/)
    }
    await expect(t.as('anon', null, `select public.my_household_id()`)).rejects.toThrow(/permission/)
  })
})

// ------------------------------------------------------------------ telegram

describe('telegram: linking, outbox, dedupe', () => {
  let t: Awaited<ReturnType<typeof freshDb>>
  let hid: string
  beforeAll(async () => {
    t = await freshDb()
    await t.addUser(SUAMI, 'suami@gmail.com')
    await t.as('authenticated', SUAMI, `insert into household_invites (email, household_id) values ('istri@gmail.com', my_household_id())`)
    await t.addUser(ISTRI, 'istri@gmail.com')
    hid = (await t.householdOf(SUAMI))!
  })

  it('kode linking: format, sekali per jenis, hanya untuk user login', async () => {
    const [a] = await t.as<{ code: string }>('authenticated', SUAMI, `select * from create_telegram_link_code('account')`)
    const [b] = await t.as<{ code: string }>('authenticated', SUAMI, `select * from create_telegram_link_code('account')`)
    expect(a.code).toMatch(/^[0-9A-F]{12}$/)
    expect(b.code).not.toBe(a.code)
    expect((await t.db.query(`select 1 from telegram_link_codes`)).rows).toHaveLength(1)
    await expect(t.as('anon', null, `select * from create_telegram_link_code('account')`)).rejects.toThrow(/permission/)
    await expect(t.as('authenticated', SUAMI, `select * from telegram_link_codes`)).rejects.toThrow(/permission/)
  })

  it('akun & grup hanya ditulis service role; anggota hanya bisa melihat & memutus miliknya', async () => {
    await t.as('service_role', null, `insert into telegram_accounts (user_id, household_id, telegram_user_id, chat_id) values ($1, $2, 111, 111), ($3, $2, 222, 222)`, [SUAMI, hid, ISTRI])
    await t.as('service_role', null, `insert into telegram_groups (chat_id, household_id, title) values (-100, $1, 'Keluarga')`, [hid])
    expect(await t.as('authenticated', ISTRI, `select count(*)::int n from telegram_accounts`)).toEqual([{ n: 2 }])
    await expect(t.as('authenticated', ISTRI, `insert into telegram_accounts (user_id, household_id, telegram_user_id, chat_id) values ($1, $2, 3, 3)`, [ISTRI, hid])).rejects.toThrow(/permission/)
    expect(await t.as('authenticated', ISTRI, `delete from telegram_accounts where user_id = $1 returning 1`, [SUAMI])).toEqual([])
  })

  it('pengeluaran besar dari web / chat pribadi masuk antrean; dari grup, kecil, atau pemasukan tidak', async () => {
    await t.as('authenticated', ISTRI, `insert into transactions (amount, category) values (750000, 'savings')`)
    await t.as('authenticated', ISTRI, `insert into transactions (amount, category) values (100000, 'savings')`)
    await t.as('authenticated', ISTRI, `insert into transactions (amount, category) values (9000000, 'income')`)
    await t.as('service_role', null, `insert into transactions (household_id, user_id, amount, category, source, telegram_chat_id) values ($1, $2, 800000, 'savings', 'telegram', -100), ($1, $2, 800000, 'savings', 'telegram', 111)`, [hid, SUAMI])
    expect(await t.db.query(`select count(*)::int n from telegram_outbox where kind = 'big_expense'`).then((r) => r.rows)).toEqual([{ n: 2 }])
  })

  it('telegram_updates: update_id unik & tertutup untuk klien', async () => {
    await t.as('service_role', null, `insert into telegram_updates (update_id, telegram_user_id) values (1, 111)`)
    await expect(t.as('service_role', null, `insert into telegram_updates (update_id, telegram_user_id) values (1, 111)`)).rejects.toThrow(/duplicate/)
    await expect(t.as('authenticated', SUAMI, `select * from telegram_updates`)).rejects.toThrow(/permission/)
  })

  it('pengaturan notifikasi bisa diubah anggota, kolom lain terkunci', async () => {
    await t.as('authenticated', ISTRI, `update households set notify_threshold = 1000000, budget_alerts_enabled = false, summaries_enabled = false`)
    const [h] = (await t.db.query<{ notify_threshold: number; budget_alerts_enabled: boolean; summaries_enabled: boolean }>(
      `select notify_threshold, budget_alerts_enabled, summaries_enabled from households where id = $1`, [hid])).rows
    expect({ ...h, notify_threshold: Number(h.notify_threshold) }).toEqual({ notify_threshold: 1000000, budget_alerts_enabled: false, summaries_enabled: false })
    await expect(t.as('authenticated', ISTRI, `update households set id = gen_random_uuid()`)).rejects.toThrow(/permission/)
  })
})

// ------------------------------------------------------------------ peringatan budget

describe('peringatan budget 80% / 100%', () => {
  let t: Awaited<ReturnType<typeof freshDb>>
  const alerts = async () =>
    (await t.db.query<{ category: string; level: number; actual: number; plan: number; month: number }>(
      `select payload->>'category' as category, (payload->>'level')::int as level, (payload->>'actual')::bigint as actual,
              (payload->>'plan')::bigint as plan, (payload->>'month')::int as month
       from telegram_outbox where kind = 'budget_alert' order by id`)).rows.map((r) => ({ ...r, actual: Number(r.actual), plan: Number(r.plan) }))
  const spend = (amount: number, category = 'household', date = '2026-11-10') =>
    t.as('authenticated', SUAMI, `insert into transactions (date, amount, category) values ($1, $2, $3)`, [date, amount, category])

  beforeAll(async () => {
    t = await freshDb()
    await t.addUser(SUAMI, 'suami@gmail.com')
    await t.as('authenticated', SUAMI, `insert into budget_items (name, category, amount, effective_from) values
      ('Belanja', 'household', 600000, '2026-01-01'), ('Bensin', 'household', 400000, '2026-01-01'),
      ('Listrik', 'bills', 500000, '2026-01-01'),
      ('Pajak motor', 'bills', 1000000, '2026-01-01')`)
    // item tahunan: hanya dihitung di bulan jatuh temponya
    await t.db.exec(`update budget_items set frequency = 'yearly', due_month = 8 where name = 'Pajak motor'`)
  })

  it('tidak ada peringatan di bawah 80%', async () => {
    await spend(700_000)
    expect(await alerts()).toEqual([])
  })

  it('melewati 80% → satu peringatan level 80 (rencana = jumlah item kategori itu)', async () => {
    await spend(150_000)
    expect(await alerts()).toEqual([{ category: 'household', level: 80, actual: 850_000, plan: 1_000_000, month: 11 }])
  })

  it('tetap di antara 80–100% → tidak dikirim ulang', async () => {
    await spend(50_000)
    expect(await alerts()).toHaveLength(1)
  })

  it('melewati 100% → peringatan level 100, sekali saja', async () => {
    await spend(200_000)
    await spend(10_000)
    expect((await alerts()).map((a) => a.level)).toEqual([80, 100])
  })

  it('lompat langsung >100% hanya kirim level 100; item tahunan di luar bulannya tidak dihitung', async () => {
    await spend(600_000, 'bills') // rencana bills Nov = 500rb (pajak motor hanya Agustus)
    const last = (await alerts()).at(-1)
    expect(last).toMatchObject({ category: 'bills', level: 100, plan: 500_000, actual: 600_000 })
  })

  it('bulan baru dihitung ulang', async () => {
    await spend(900_000, 'household', '2026-12-05')
    expect((await alerts()).at(-1)).toMatchObject({ category: 'household', level: 80, month: 12 })
  })

  it('kategori tabungan/hutang tidak memicu peringatan; bisa dimatikan', async () => {
    const before = (await alerts()).length
    await spend(5_000_000, 'savings')
    await t.as('authenticated', SUAMI, `update households set budget_alerts_enabled = false`)
    await spend(5_000_000, 'household', '2027-01-05')
    expect(await alerts()).toHaveLength(before)
  })
})
