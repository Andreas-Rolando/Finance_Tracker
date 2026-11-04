// Tugas terjadwal Telegram, dipanggil pg_cron (lihat migrasi telegram_cron).
//   ?task=outbox     → kirim notifikasi pengeluaran besar ke grup
//   ?task=reminders  → pengingat jatuh tempo harian (07:00 WIB)
// Deploy: supabase functions deploy telegram-cron --no-verify-jwt
// Keamanan: header x-cron-secret wajib = TELEGRAM_CRON_SECRET.
import {
  addDays,
  CATEGORY_EMOJI,
  CATEGORY_LABEL,
  dueEntries,
  escapeHtml,
  formatDay,
  formatIDR,
  todayWIB,
  ymOf,
} from '../_shared/core.ts'
import {
  db,
  getTx,
  householdGroupChat,
  loadItems,
  loadMonthTx,
  memberChats,
  profileName,
} from '../_shared/data.ts'
import { send } from '../_shared/telegram.ts'

const CRON_SECRET = Deno.env.get('TELEGRAM_CRON_SECRET')

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response('unauthorized', { status: 401 })
  }
  const task = new URL(req.url).searchParams.get('task')
  try {
    if (task === 'outbox') return Response.json(await flushOutbox())
    if (task === 'reminders') return Response.json(await sendReminders())
    return new Response('unknown task', { status: 400 })
  } catch (e) {
    console.error(`cron ${task} error`, e)
    return new Response('error', { status: 500 })
  }
})

// ------------------------------------------------------------------ outbox

async function flushOutbox() {
  const { data: rows, error } = await db
    .from('telegram_outbox')
    .select('*')
    .is('sent_at', null)
    .lt('attempts', 5)
    .order('created_at')
    .limit(20)
  if (error) throw error
  let sent = 0
  for (const row of rows ?? []) {
    try {
      const done = await deliver(row)
      await db.from('telegram_outbox').update({ sent_at: new Date().toISOString(), last_error: done ? null : 'skipped' }).eq('id', row.id)
      if (done) sent++
    } catch (e) {
      await db
        .from('telegram_outbox')
        .update({ attempts: row.attempts + 1, last_error: String(e).slice(0, 500) })
        .eq('id', row.id)
    }
  }
  return { processed: rows?.length ?? 0, sent }
}

async function deliver(row: { household_id: string; kind: string; payload: { transaction_id?: string } }): Promise<boolean> {
  if (row.kind !== 'big_expense' || !row.payload.transaction_id) return false
  const chatId = await householdGroupChat(row.household_id)
  const tx = await getTx(row.payload.transaction_id)
  if (!chatId || !tx || tx.household_id !== row.household_id) return false // grup diputus / transaksi sudah dihapus
  const [author, item] = await Promise.all([
    profileName(tx.user_id),
    tx.budget_item_id ? db.from('budget_items').select('name').eq('id', tx.budget_item_id).maybeSingle() : null,
  ])
  const title = item?.data?.name ?? tx.note ?? CATEGORY_LABEL[tx.category]
  const lines = [
    `💸 <b>${escapeHtml(author)}</b> mencatat pengeluaran besar${tx.source === 'app' ? ' (via web)' : ''}`,
    `<b>${escapeHtml(title)}</b> — ${formatIDR(tx.amount)}`,
    `${CATEGORY_EMOJI[tx.category]} ${CATEGORY_LABEL[tx.category]} · ${formatDay(tx.date)}`,
  ]
  if (tx.note && tx.note !== title) lines.push(`📝 ${escapeHtml(tx.note)}`)
  const res = await send(chatId, lines.join('\n'))
  if (!res) throw new Error('sendMessage gagal')
  return true
}

// ------------------------------------------------------------------ pengingat

async function sendReminders() {
  const today = todayWIB()
  const tomorrow = addDays(today, 1)
  const ym = ymOf(today)
  const { data: households, error } = await db.from('households').select('id').eq('reminders_enabled', true)
  if (error) throw error
  let notified = 0
  for (const h of households ?? []) {
    const group = await householdGroupChat(h.id)
    const chats = group ? [group] : await memberChats(h.id)
    if (!chats.length) continue
    const [items, txs] = await Promise.all([loadItems(h.id, `${today.slice(0, 7)}-01`), loadMonthTx(h.id, ym)])
    const due = dueEntries(items, txs, ym, today).filter((d) => d.status !== 'paid' && d.date <= tomorrow)
    if (!due.length) continue
    const section = (title: string, list: typeof due) =>
      list.length
        ? [title, ...list.map((d) => `• ${escapeHtml(d.item.name)} — ${formatIDR(d.item.amount)}${d.date < today ? ` (tgl ${Number(d.date.slice(8))})` : ''}`), '']
        : []
    const text = [
      `⏰ <b>Pengingat jatuh tempo</b> — ${formatDay(today)}`,
      '',
      ...section('🔴 <b>Telat</b>', due.filter((d) => d.date < today)),
      ...section('🟡 <b>Hari ini</b>', due.filter((d) => d.date === today)),
      ...section('⚪ <b>Besok</b>', due.filter((d) => d.date === tomorrow)),
      'Sudah dibayar? Tekan tombolnya supaya tercatat.',
    ].join('\n')
    const kb = due.slice(0, 8).map((d) => [{ text: `✅ Bayar ${d.item.name}`, callback_data: `b:${d.item.id}` }])
    for (const chatId of chats) if (await send(chatId, text, kb)) notified++
  }
  return { households: households?.length ?? 0, notified }
}
