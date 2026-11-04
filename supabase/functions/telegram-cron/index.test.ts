// Test integrasi telegram-cron: fetch di-stub (Supabase REST + Telegram API palsu).
import { assert, assertEquals } from 'jsr:@std/assert@1'

Deno.env.set('SUPABASE_URL', 'http://supabase.test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-key')
Deno.env.set('TELEGRAM_BOT_TOKEN', 'bot-token')
Deno.env.set('TELEGRAM_CRON_SECRET', 'cron-secret')

type Row = Record<string, unknown>
const TODAY = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
const state = { outbox: [] as Row[], patched: [] as Row[], sent: [] as Row[], txs: [] as Row[], group: true }

const items = [
  { id: 'i-belanja', name: 'Belanja', category: 'household', amount: 1000000, frequency: 'monthly', due_day: null, due_month: null, debt_id: null, savings_goal_id: null, effective_from: '2020-01-01', effective_to: null },
  { id: 'i-listrik', name: 'Listrik', category: 'bills', amount: 500000, frequency: 'monthly', due_day: 20, due_month: null, debt_id: null, savings_goal_id: null, effective_from: '2020-01-01', effective_to: null },
]

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// deno-lint-ignore no-explicit-any require-await
globalThis.fetch = (async (input: any, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input.url)
  const method = (init?.method ?? 'GET').toUpperCase()
  const single = (new Headers(init?.headers).get('Accept') ?? '').includes('vnd.pgrst.object')
  const body = init?.body ? JSON.parse(String(init.body)) : undefined
  if (url.hostname === 'api.telegram.org') {
    state.sent.push({ method: url.pathname.split('/').pop(), ...body })
    return json({ ok: true, result: { message_id: 1 } })
  }
  const table = url.pathname.replace('/rest/v1/', '')
  const reply = (rows: Row[]) => (single ? (rows[0] ? json(rows[0]) : json({ code: 'PGRST116' }, 406)) : json(rows))
  if (method === 'PATCH') { state.patched.push({ table, ...body }); return reply([]) }
  switch (table) {
    case 'telegram_outbox': return reply(state.outbox)
    case 'telegram_groups': return reply(state.group ? [{ chat_id: -100 }] : [])
    case 'telegram_accounts': return reply([{ chat_id: 111 }, { chat_id: 222 }])
    case 'households': return reply([{ id: 'h1' }])
    case 'budget_items': return reply(items)
    case 'transactions': return reply(state.txs)
    case 'debts': return reply([{ id: 'd1', name: 'KTA', principal: 10000000, monthly_installment: 1000000 }])
    case 'v_debt_paid': return reply([{ debt_id: 'd1', paid: 4000000 }])
    default: return reply([])
  }
}) as typeof fetch

let handler: (req: Request) => Promise<Response>
// deno-lint-ignore no-explicit-any
;(Deno as any).serve = (h: typeof handler) => { handler = h; return { finished: Promise.resolve() } }
await import('./index.ts')

const run = (task: string, secret = 'cron-secret') =>
  handler(new Request(`http://fn.test/telegram-cron?task=${task}`, { method: 'POST', headers: { 'x-cron-secret': secret } }))
const reset = () => { state.outbox = []; state.patched = []; state.sent = []; state.txs = []; state.group = true }
const texts = () => state.sent.filter((s) => s.method === 'sendMessage').map((s) => String(s.text))

Deno.test('menolak tanpa secret', async () => {
  reset()
  assertEquals((await run('outbox', 'salah')).status, 401)
})

Deno.test('peringatan budget 80% dikirim ke grup & ditandai terkirim', async () => {
  reset()
  state.outbox = [{ id: 1, household_id: 'h1', kind: 'budget_alert', attempts: 0, payload: { category: 'household', level: 80, plan: 1000000, actual: 850000, year: 2026, month: 11 } }]
  const res = await (await run('outbox')).json()
  assertEquals(res.sent, 1)
  const [t] = texts()
  assert(t.includes('Rumah Tangga') && t.includes('85%') && t.includes('sisa') && t.includes('Rp 150.000'))
  assertEquals(state.sent[0].chat_id, -100)
  assert(state.patched.some((p) => p.table === 'telegram_outbox' && p.sent_at))
})

Deno.test('peringatan 100% tanpa grup → ke chat pribadi tiap anggota', async () => {
  reset(); state.group = false
  state.outbox = [{ id: 2, household_id: 'h1', kind: 'budget_alert', attempts: 0, payload: { category: 'bills', level: 100, plan: 500000, actual: 600000, year: 2026, month: 11 } }]
  await run('outbox')
  assertEquals(state.sent.map((s) => s.chat_id), [111, 222])
  assert(texts()[0].includes('melewati') && texts()[0].includes('lebih') && texts()[0].includes('Rp 100.000'))
})

Deno.test('ringkasan mingguan: total, terbesar, progres bulan ini', async () => {
  reset()
  state.txs = [
    { id: 't1', date: TODAY, amount: 300000, category: 'household', budget_item_id: 'i-belanja', debt_id: null, savings_goal_id: null, note: null, user_id: 'u1' },
    { id: 't2', date: TODAY, amount: 50000, category: 'household', budget_item_id: null, debt_id: null, savings_goal_id: null, note: 'Kopi', user_id: 'u1' },
    { id: 't3', date: TODAY, amount: 9000000, category: 'income', budget_item_id: null, debt_id: null, savings_goal_id: null, note: null, user_id: 'u1' },
  ]
  await run('weekly')
  const [t] = texts()
  assert(t.includes('Ringkasan minggu ini'))
  assert(t.includes('Rp 350.000') && t.includes('2 transaksi'), t)
  assert(t.includes('Belanja') && t.includes('Terbesar'))
  assert(t.includes('Rumah Tangga 35%'), t)
})

Deno.test('laporan bulanan: bulan lalu, per kategori, sisa hutang', async () => {
  reset()
  state.txs = [{ id: 't1', date: TODAY, amount: 1200000, category: 'household', budget_item_id: null, debt_id: null, savings_goal_id: null, note: null, user_id: 'u1' }]
  await run('monthly')
  const [t] = texts()
  assert(t.includes('Laporan'))
  assert(t.includes('Melebihi rencana') && t.includes('Rumah Tangga (+Rp 200.000)'), t)
  assert(t.includes('Rp 6.000.000'), t) // sisa hutang 10jt - 4jt
})
