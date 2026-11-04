// Test integrasi webhook: fetch di-stub (Supabase REST + Telegram API palsu).
// Jalankan: npx deno test --allow-env --allow-read supabase/functions/telegram-webhook/index.test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1'

Deno.env.set('SUPABASE_URL', 'http://supabase.test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-key')
Deno.env.set('TELEGRAM_BOT_TOKEN', 'bot-token')
Deno.env.set('TELEGRAM_WEBHOOK_SECRET', 'hook-secret')

type Row = Record<string, unknown>
const state: {
  linked: boolean
  inserted: Row[]
  deleted: string[]
  sent: Row[]
  pending: Row[]
  updates: { update_id: number; telegram_user_id: number | null; received_at: string }[]
} = { linked: true, inserted: [], deleted: [], sent: [], pending: [], updates: [] }

const TODAY = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
const items = [
  { id: 'i-bensin', name: 'Bensin', category: 'household', amount: 300000, frequency: 'monthly', due_day: null, due_month: null, debt_id: null, savings_goal_id: null, effective_from: '2026-01-01', effective_to: null },
  { id: 'i-cc', name: 'Kartu Kredit', category: 'debt', amount: 1500000, frequency: 'monthly', due_day: 15, due_month: null, debt_id: 'd1', savings_goal_id: null, effective_from: '2026-01-01', effective_to: null },
]

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// deno-lint-ignore no-explicit-any require-await
globalThis.fetch = (async (input: any, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input.url)
  const method = (init?.method ?? 'GET').toUpperCase()
  const headers = new Headers(init?.headers)
  const single = (headers.get('Accept') ?? '').includes('vnd.pgrst.object')
  const body = init?.body ? JSON.parse(String(init.body)) : undefined

  if (url.hostname === 'api.telegram.org') {
    state.sent.push({ method: url.pathname.split('/').pop(), ...body })
    if (url.pathname.endsWith('/getMe')) return json({ ok: true, result: { can_read_all_group_messages: true } })
    return json({ ok: true, result: { message_id: 999, chat: { id: body.chat_id } } })
  }

  const table = url.pathname.replace('/rest/v1/', '')
  const reply = (rows: Row[]) => (single ? (rows[0] ? json(rows[0]) : json({ code: 'PGRST116' }, 406)) : json(rows))
  if (method === 'GET') {
    switch (table) {
      case 'telegram_accounts':
        return reply(state.linked ? [{ user_id: 'u1', household_id: 'h1', first_name: 'Nando' }] : [])
      case 'profiles': return reply([{ full_name: 'Nando Rolando', email: 'n@x.com' }])
      case 'telegram_groups': return reply([])
      case 'budget_items': return reply(url.searchParams.get('id') ? items.filter((i) => `eq.${i.id}` === url.searchParams.get('id')) : items)
      case 'debts':
        return reply(url.searchParams.get('id') ? [{ name: 'Kartu Kredit', principal: 10000000 }] : [{ id: 'd1', name: 'Kartu Kredit', principal: 10000000, monthly_installment: 1500000 }])
      case 'savings_goals': return reply([])
      case 'v_debt_paid': return reply([{ paid: 3000000 }])
      case 'transactions': return reply([])
      case 'telegram_updates': {
        const uid = Number((url.searchParams.get('telegram_user_id') ?? '').replace('eq.', ''))
        return reply(state.updates.filter((u) => u.telegram_user_id === uid))
      }
      default: return reply([])
    }
  }
  if (method === 'POST' && table === 'telegram_updates') {
    if (state.updates.some((u) => u.update_id === body.update_id)) {
      return json({ code: '23505', message: 'duplicate key value violates unique constraint' }, 409)
    }
    state.updates.push({ ...body, received_at: new Date().toISOString() })
    return json([body], 201)
  }
  if (method === 'POST') {
    const row = { id: `tx-${state.inserted.length + 1}`, created_at: new Date().toISOString(), ...body }
    if (table === 'transactions') state.inserted.push(row)
    if (table === 'telegram_pending') state.pending.push(row)
    return reply([row])
  }
  if (method === 'DELETE') { state.deleted.push(table); return reply([]) }
  return reply([])
}) as typeof fetch

// Tangkap handler dari Deno.serve.
let handler: (req: Request) => Promise<Response>
// deno-lint-ignore no-explicit-any
;(Deno as any).serve = (h: typeof handler) => { handler = h; return { finished: Promise.resolve() } }
await import('./index.ts')

const post = (update: unknown, secret = 'hook-secret') =>
  handler(new Request('http://fn.test/telegram-webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret },
    body: JSON.stringify(update),
  }))

let nextUpdate = 1
const msg = (text: string, chat: Row = { id: 111, type: 'private' }) => ({
  update_id: nextUpdate++,
  message: { message_id: 10, from: { id: 111, first_name: 'Nando' }, chat, text },
})

const reset = () => { state.inserted = []; state.sent = []; state.deleted = []; state.pending = []; state.linked = true; state.updates = [] }

Deno.test('menolak request tanpa secret yang benar', async () => {
  reset()
  assertEquals((await post(msg('bensin 50rb'), 'salah')).status, 401)
  assertEquals(state.sent.length + state.inserted.length, 0)
})

Deno.test('akun belum terhubung → petunjuk, tidak mencatat', async () => {
  reset(); state.linked = false
  await post(msg('bensin 50rb'))
  assertEquals(state.inserted.length, 0)
  assert(String(state.sent[0].text).includes('belum terhubung'))
})

Deno.test('mencatat transaksi dengan household & pencatat dari akun terhubung', async () => {
  reset()
  assertEquals((await post(msg('bensin 50rb'))).status, 200)
  assertEquals(state.inserted.length, 1)
  const tx = state.inserted[0]
  assertEquals(tx.household_id, 'h1')
  assertEquals(tx.user_id, 'u1')
  assertEquals(tx.amount, 50000)
  assertEquals(tx.category, 'household')
  assertEquals(tx.budget_item_id, 'i-bensin')
  assertEquals(tx.source, 'telegram')
  assertEquals(tx.telegram_chat_id, 111)
  assertEquals(tx.date, TODAY)
  const reply = state.sent.find((s) => s.method === 'sendMessage')!
  assert(String(reply.text).includes('Bensin'))
  assert(String(reply.text).includes('Rp 50.000'))
  // tombol batal & kategori
  // deno-lint-ignore no-explicit-any
  const kb = (reply.reply_markup as any).inline_keyboard.flat().map((b: any) => b.callback_data)
  assertEquals(kb, ['u:tx-1', 'c:tx-1'])
})

Deno.test('pembayaran hutang menampilkan sisa hutang', async () => {
  reset()
  await post(msg('bayar kartu kredit 1,5jt'))
  assertEquals(state.inserted[0].debt_id, 'd1')
  assertEquals(state.inserted[0].budget_item_id, 'i-cc')
  assert(String(state.sent.find((s) => s.method === 'sendMessage')!.text).includes('Sisa hutang'))
})

Deno.test('kategori tidak dikenal → pending + tombol kategori, belum dicatat', async () => {
  reset()
  await post(msg('kado ulang tahun 150rb'))
  assertEquals(state.inserted.length, 0)
  assertEquals(state.pending.length, 1)
  assertEquals(state.pending[0].household_id, 'h1')
  // deno-lint-ignore no-explicit-any
  const kb = (state.sent[0].reply_markup as any).inline_keyboard.flat().map((b: any) => b.callback_data)
  assert(kb.includes('p:tx-1:household'))
  assert(kb.includes('p:tx-1:x'))
})

Deno.test('beberapa baris → beberapa transaksi', async () => {
  reset()
  await post(msg('bensin 50rb\nkemarin parkir 5rb'))
  assertEquals(state.inserted.length, 2)
  assertEquals(state.inserted[1].amount, 5000)
})

Deno.test('obrolan grup tanpa nominal diabaikan diam-diam', async () => {
  reset()
  await post(msg('otw ya', { id: -100, type: 'supergroup', title: 'Keluarga' }))
  assertEquals(state.sent.length, 0)
  assertEquals(state.inserted.length, 0)
})

Deno.test('grup yang belum terhubung tidak mencatat', async () => {
  reset()
  await post(msg('bensin 50rb', { id: -100, type: 'supergroup', title: 'Keluarga' }))
  assertEquals(state.inserted.length, 0)
})

Deno.test('/bantuan membalas format', async () => {
  reset()
  await post(msg('/bantuan'))
  assert(String(state.sent[0].text).includes('Cara mencatat'))
})

Deno.test('/start dengan kode tidak valid', async () => {
  reset()
  await post(msg('/start ABC123'))
  assert(String(state.sent[0].text).includes('tidak valid'))
})

Deno.test('update yang dikirim ulang Telegram tidak dicatat dua kali', async () => {
  reset()
  const u = msg('bensin 50rb')
  await post(u)
  await post(u) // retry dengan update_id yang sama
  assertEquals(state.inserted.length, 1)
})

Deno.test('batas pesan per menit: pesan ke-21 diberi peringatan, sisanya diabaikan', async () => {
  reset()
  for (let i = 0; i < 23; i++) await post(msg(`jajan ${i + 1}rb`))
  assertEquals(state.inserted.length, 20)
  const warnings = state.sent.filter((s) => String(s.text).includes('Terlalu banyak'))
  assertEquals(warnings.length, 1)
})
