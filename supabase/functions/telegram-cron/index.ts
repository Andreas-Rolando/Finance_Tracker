// Tugas terjadwal Telegram, dipanggil pg_cron (lihat migrasi telegram_cron & summaries_realtime).
//   ?task=outbox     → notifikasi pengeluaran besar & peringatan budget
//   ?task=reminders  → pengingat jatuh tempo harian (07:00 WIB)
//   ?task=weekly     → ringkasan 7 hari terakhir (Minggu 20:00 WIB)
//   ?task=monthly    → ringkasan bulan lalu (tanggal 1, 08:00 WIB)
// Deploy: supabase functions deploy telegram-cron (verify_jwt=false di config.toml)
// Keamanan: header x-cron-secret wajib = TELEGRAM_CRON_SECRET.
import {
  addDays,
  addMonths,
  balanceOf,
  CATEGORY_EMOJI,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  type Category,
  dueEntries,
  escapeHtml,
  formatDay,
  formatIDR,
  formatMonth,
  monthEnd,
  monthStart,
  planTotals,
  sumByCategory,
  todayWIB,
  type TxRow,
  type YM,
  ymOf,
} from '../_shared/core.ts'
import {
  db,
  getTx,
  householdGroupChat,
  loadDebts,
  loadItems,
  loadMonthTx,
  loadTxRange,
  profileName,
  targetChats,
} from '../_shared/data.ts'
import { send } from '../_shared/telegram.ts'

const CRON_SECRET = Deno.env.get('TELEGRAM_CRON_SECRET')?.trim()

Deno.serve(async (req) => {
  const got = req.headers.get('x-cron-secret')?.trim() ?? ''
  if (!CRON_SECRET || got !== CRON_SECRET) {
    console.error(CRON_SECRET ? `401: secret cron tidak cocok (diterima ${got.length}, di Supabase ${CRON_SECRET.length} karakter)` : '401: TELEGRAM_CRON_SECRET belum di-set')
    return new Response('unauthorized', { status: 401 })
  }
  const task = new URL(req.url).searchParams.get('task')
  try {
    if (task === 'outbox') return Response.json(await flushOutbox())
    if (task === 'reminders') return Response.json(await sendReminders())
    if (task === 'weekly') return Response.json(await sendWeekly())
    if (task === 'monthly') return Response.json(await sendMonthly())
    return new Response('unknown task', { status: 400 })
  } catch (e) {
    console.error(`cron ${task} error`, e)
    return new Response('error', { status: 500 })
  }
})

const EXPENSES: Category[] = CATEGORY_ORDER.filter((c) => c !== 'income')

// ------------------------------------------------------------------ outbox

interface OutboxRow {
  id: number
  household_id: string
  kind: string
  attempts: number
  payload: Record<string, unknown>
}

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
  for (const row of (rows ?? []) as OutboxRow[]) {
    try {
      const done = row.kind === 'budget_alert' ? await deliverBudgetAlert(row) : await deliverBigExpense(row)
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

async function sendAll(chats: number[], text: string): Promise<boolean> {
  if (!chats.length) return false
  let ok = false
  for (const c of chats) if (await send(c, text)) ok = true
  if (!ok) throw new Error('sendMessage gagal')
  return true
}

async function deliverBigExpense(row: OutboxRow): Promise<boolean> {
  const txId = row.payload.transaction_id as string | undefined
  const chatId = await householdGroupChat(row.household_id)
  const tx = txId ? await getTx(txId) : null
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
  return sendAll([chatId], lines.join('\n'))
}

async function deliverBudgetAlert(row: OutboxRow): Promise<boolean> {
  const p = row.payload as { category: Category; level: number; plan: number; actual: number; year: number; month: number }
  const plan = Number(p.plan)
  const actual = Number(p.actual)
  const ym = { year: Number(p.year), month: Number(p.month) }
  const label = `${CATEGORY_EMOJI[p.category]} <b>${CATEGORY_LABEL[p.category]}</b>`
  const pct = Math.round((actual / plan) * 100)
  const text = Number(p.level) >= 100
    ? [
        `🔴 ${label} melewati rencana ${formatMonth(ym)}`,
        `${formatIDR(actual)} / ${formatIDR(plan)} (${pct}%) · lebih <b>${formatIDR(actual - plan)}</b>`,
        '',
        'Cek pengeluaran dengan /ringkasan.',
      ].join('\n')
    : [
        `⚠️ ${label} sudah ${pct}% dari rencana ${formatMonth(ym)}`,
        `${formatIDR(actual)} / ${formatIDR(plan)} · sisa <b>${formatIDR(plan - actual)}</b>`,
      ].join('\n')
  return sendAll(await targetChats(row.household_id), text)
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
    const chats = await targetChats(h.id)
    if (!chats.length) continue
    const [items, txs] = await Promise.all([loadItems(h.id, monthStart(ym)), loadMonthTx(h.id, ym)])
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

// ------------------------------------------------------------------ ringkasan

async function summaryHouseholds() {
  const { data, error } = await db.from('households').select('id').eq('summaries_enabled', true)
  if (error) throw error
  return data ?? []
}

async function itemNames(txs: TxRow[]): Promise<Map<string, string>> {
  const ids = [...new Set(txs.map((t) => t.budget_item_id).filter(Boolean) as string[])]
  const map = new Map<string, string>()
  if (!ids.length) return map
  const { data } = await db.from('budget_items').select('id, name').in('id', ids)
  for (const r of data ?? []) map.set(r.id, r.name)
  return map
}

const pctOf = (a: number, p: number) => (p > 0 ? Math.round((a / p) * 100) : null)

async function sendWeekly() {
  const today = todayWIB()
  const from = addDays(today, -6)
  const ym = ymOf(today)
  let notified = 0
  for (const h of await summaryHouseholds()) {
    const chats = await targetChats(h.id)
    if (!chats.length) continue
    const [week, month, items] = await Promise.all([
      loadTxRange(h.id, from, today),
      loadMonthTx(h.id, ym),
      loadItems(h.id, monthStart(ym)),
    ])
    const out = week.filter((t) => t.category !== 'income')
    const weekTotals = sumByCategory(out)
    const total = out.reduce((s, t) => s + t.amount, 0)
    const names = await itemNames(out)
    const top = [...out].sort((a, b) => b.amount - a.amount).slice(0, 3)
    const plan = planTotals(items, ym)
    const actual = sumByCategory(month)

    const lines = [`📅 <b>Ringkasan minggu ini</b> — ${formatDay(from)} s/d ${formatDay(today)}`, '']
    if (!out.length) lines.push('Tidak ada pengeluaran tercatat minggu ini.')
    else {
      lines.push(`Total pengeluaran: <b>${formatIDR(total)}</b> (${out.length} transaksi)`)
      for (const c of EXPENSES) if (weekTotals[c]) lines.push(`${CATEGORY_EMOJI[c]} ${CATEGORY_LABEL[c]}: ${formatIDR(weekTotals[c])}`)
      lines.push('', '<b>Terbesar:</b>')
      for (const t of top) {
        const title = (t.budget_item_id && names.get(t.budget_item_id)) || t.note || CATEGORY_LABEL[t.category]
        lines.push(`• ${escapeHtml(title)} — ${formatIDR(t.amount)} (${formatDay(t.date)})`)
      }
    }
    const progress = (['household', 'bills'] as Category[])
      .map((c) => ({ c, p: pctOf(actual[c], plan[c]) }))
      .filter((x) => x.p != null)
      .map(({ c, p }) => `${CATEGORY_EMOJI[c]} ${CATEGORY_LABEL[c]} ${p}%${p! >= 100 ? ' 🔴' : p! >= 80 ? ' ⚠️' : ''}`)
    if (progress.length) lines.push('', `<b>Bulan ini vs rencana:</b> ${progress.join(' · ')}`)
    lines.push(`Sisa saldo bulan ini: <b>${formatIDR(balanceOf(actual))}</b>`)
    for (const c of chats) if (await send(c, lines.join('\n'))) notified++
  }
  return { notified }
}

async function sendMonthly() {
  const today = todayWIB()
  const ym: YM = addMonths(ymOf(today), -1) // bulan lalu
  let notified = 0
  for (const h of await summaryHouseholds()) {
    const chats = await targetChats(h.id)
    if (!chats.length) continue
    const [txs, items, debts] = await Promise.all([
      loadMonthTx(h.id, ym),
      loadItems(h.id, monthStart(ym)),
      loadDebts(h.id),
    ])
    const plan = planTotals(items, ym)
    const actual = sumByCategory(txs)
    const bal = balanceOf(actual)

    const lines = [`🗓️ <b>Laporan ${formatMonth(ym)}</b>`, '<i>realisasi / rencana</i>', '']
    for (const c of CATEGORY_ORDER) {
      const p = pctOf(actual[c], plan[c])
      const flag = c !== 'income' && c !== 'savings' && p != null && p > 100 ? ' 🔴' : ''
      lines.push(`${CATEGORY_EMOJI[c]} ${CATEGORY_LABEL[c]}: <b>${formatIDR(actual[c])}</b> / ${formatIDR(plan[c])}${p != null ? ` (${p}%)` : ''}${flag}`)
    }
    lines.push('', `Sisa saldo: <b>${formatIDR(bal)}</b>${bal < 0 ? ' — defisit 🔴' : ' ✅'}`)

    const over = (['household', 'bills'] as Category[]).filter((c) => plan[c] > 0 && actual[c] > plan[c])
    if (over.length) lines.push(`Melebihi rencana: ${over.map((c) => `${CATEGORY_LABEL[c]} (+${formatIDR(actual[c] - plan[c])})`).join(', ')}`)

    if (debts.length) {
      const paidThisMonth = txs.filter((t) => t.category === 'debt').reduce((s, t) => s + t.amount, 0)
      const { data: paidRows } = await db.from('v_debt_paid').select('debt_id, paid').in('debt_id', debts.map((d) => d.id))
      const paid = new Map((paidRows ?? []).map((r) => [r.debt_id, Number(r.paid)]))
      const remaining = debts.reduce((s, d) => s + Math.max(d.principal - (paid.get(d.id) ?? 0), 0), 0)
      lines.push('', `💳 Hutang dibayar bulan itu: ${formatIDR(paidThisMonth)} · sisa total sekarang <b>${formatIDR(remaining)}</b>`)
    }
    lines.push('', `Rekap lengkap ada di web → Tahunan. Semangat untuk ${formatMonth(addMonths(ym, 1))}! 💪`)
    for (const c of chats) if (await send(c, lines.join('\n'))) notified++
  }
  return { month: `${ym.year}-${ym.month}`, notified, range: [monthStart(ym), monthEnd(ym)] }
}
