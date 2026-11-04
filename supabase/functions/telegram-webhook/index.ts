// Telegram webhook → catat transaksi keuangan rumah tangga.
// Deploy: supabase functions deploy telegram-webhook --no-verify-jwt
// Keamanan: header X-Telegram-Bot-Api-Secret-Token wajib = TELEGRAM_WEBHOOK_SECRET.
import {
  addDays,
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
  planTotals,
  sumByCategory,
  todayWIB,
  ymOf,
} from '../_shared/core.ts'
import {
  type Account,
  cleanup,
  db,
  debtRemaining,
  getAccount,
  getGroup,
  getTx,
  insertTx,
  loadDebts,
  loadGoals,
  loadItems,
  loadMonthTx,
  type NewTx,
  profileName,
  renderTx,
} from '../_shared/data.ts'
import { parseMessage, type ParsedTx } from '../_shared/parser.ts'
import {
  answer,
  type Button,
  edit,
  editKeyboard,
  type Keyboard,
  send,
  tg,
  type TgCallback,
  type TgMessage,
  type TgUpdate,
} from '../_shared/telegram.ts'

const SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET')?.trim()
const BOT_USERNAME = (Deno.env.get('TELEGRAM_BOT_USERNAME') ?? '').replace(/^@/, '').toLowerCase()
const UNDO_HOURS = 24

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok')
  if (!SECRET) {
    console.error('401: secret TELEGRAM_WEBHOOK_SECRET belum di-set di Edge Functions → Secrets (lalu deploy ulang fungsi)')
    return new Response('unauthorized', { status: 401 })
  }
  const got = req.headers.get('x-telegram-bot-api-secret-token')?.trim() ?? ''
  if (got !== SECRET) {
    // Jangan pernah log isi secret — cukup panjangnya untuk diagnosis.
    console.error(`401: secret webhook tidak cocok (diterima ${got.length} karakter, di Supabase ${SECRET.length} karakter)`)
    return new Response('unauthorized', { status: 401 })
  }
  let update: TgUpdate
  try {
    update = await req.json()
  } catch {
    return new Response('bad request', { status: 400 })
  }
  try {
    if (update.message) await onMessage(update.message)
    else if (update.callback_query) await onCallback(update.callback_query)
    if (update.update_id % 50 === 0) await cleanup()
  } catch (e) {
    console.error('handler error', e)
  }
  // Selalu 200 supaya Telegram tidak mengirim ulang update yang sama.
  return new Response('ok')
})

// ================================================================== pesan

const isGroupChat = (m: TgMessage) => m.chat.type === 'group' || m.chat.type === 'supergroup'

const HELP = [
  '<b>Cara mencatat</b> — kirim seperti chat biasa:',
  '• <code>bensin 50rb</code>',
  '• <code>listrik 412.500</code>',
  '• <code>bayar kartu kredit 1,5jt</code>',
  '• <code>+gaji 9jt</code> (pemasukan)',
  '• <code>kemarin belanja 120rb</code> · <code>5/11 wifi 150rb</code>',
  '• Beberapa sekaligus: satu baris satu transaksi',
  '',
  '<b>Perintah</b>',
  '/ringkasan — gambaran bulan ini',
  '/hariini — transaksi hari ini',
  '/hutang — sisa hutang',
  '/jatuhtempo — tagihan yang belum dibayar',
  '/batal — batalkan transaksi terakhirmu',
  '/putus — putuskan bot dari chat ini',
].join('\n')

const NOT_LINKED =
  'Akun Telegram kamu belum terhubung.\nBuka web Finance Tracker → <b>Pengaturan → Telegram → Hubungkan akun</b>, lalu klik tombol <i>Buka Telegram</i>.'

async function onMessage(msg: TgMessage) {
  const text = msg.text?.trim()
  if (!text || !msg.from || msg.from.is_bot) return
  if (msg.chat.type === 'channel') return
  if (text.startsWith('/')) return onCommand(msg, text)

  const acct = await getAccount(msg.from.id)
  const group = isGroupChat(msg)
  if (!acct) {
    if (!group) await send(msg.chat.id, NOT_LINKED)
    return // di grup: abaikan anggota yang belum terhubung
  }
  if (group) {
    const g = await getGroup(msg.chat.id)
    if (!g || g.household_id !== acct.household_id) return
  }
  await recordFromText(msg, acct, text)
}

async function parseContext(householdId: string) {
  const today = todayWIB()
  const [items, debts, goals] = await Promise.all([
    loadItems(householdId, addDays(today, -62)),
    loadDebts(householdId),
    loadGoals(householdId),
  ])
  return { today, items, debts, goals }
}

async function recordFromText(msg: TgMessage, acct: Account, text: string) {
  const ctx = await parseContext(acct.household_id)
  const results = parseMessage(text, ctx)
  if (!results.some((r) => r.ok)) {
    // Di grup, obrolan biasa tanpa nominal diabaikan.
    if (!isGroupChat(msg)) await send(msg.chat.id, 'Nominalnya belum kebaca 🤔\nContoh: <code>bensin 50rb</code>\n\n/bantuan untuk format lain', undefined, msg.message_id)
    return
  }
  for (const r of results) {
    if (!r.ok) {
      await send(msg.chat.id, `⚠️ "${escapeHtml(r.source)}" — nominal tidak terbaca, tidak dicatat.`, undefined, msg.message_id)
      continue
    }
    await recordOne(msg, acct, r.tx, ctx)
  }
}

function toNewTx(t: ParsedTx, category: Category): NewTx {
  return {
    date: t.date,
    amount: t.amount,
    category,
    budget_item_id: t.budgetItemId,
    debt_id: t.debtId,
    savings_goal_id: t.goalId,
    note: t.note,
  }
}

async function recordOne(
  msg: TgMessage,
  acct: Account,
  t: ParsedTx,
  ctx: Awaited<ReturnType<typeof parseContext>>,
) {
  if (t.category === null) {
    const { data, error } = await db
      .from('telegram_pending')
      .insert({ household_id: acct.household_id, user_id: acct.user_id, chat_id: msg.chat.id, payload: t })
      .select('id')
      .single()
    if (error) throw error
    await send(
      msg.chat.id,
      `❓ <b>${escapeHtml(t.label)}</b> — ${formatIDR(t.amount)} · ${formatDay(t.date)}\nMasuk kategori apa?`,
      categoryKeyboard(`p:${data.id}`, [{ text: '❌ Batal', callback_data: `p:${data.id}:x` }]),
      msg.message_id,
    )
    return
  }
  const tx = await insertTx(acct, msg.chat.id, toNewTx(t, t.category))
  const picker = pickerFor(tx.id, tx.category, tx.debt_id, tx.savings_goal_id, ctx.debts, ctx.goals)
  const text = await renderTx(tx)
  await send(msg.chat.id, picker ? `${text}\n\n${picker.question}` : text, picker?.keyboard ?? txKeyboard(tx.id), msg.message_id)
}

// ================================================================== keyboard

function txKeyboard(txId: string): Keyboard {
  return [[
    { text: '↩️ Batalkan', callback_data: `u:${txId}` },
    { text: '✏️ Kategori', callback_data: `c:${txId}` },
  ]]
}

function categoryKeyboard(prefix: string, extra: Button[] = []): Keyboard {
  const btns = CATEGORY_ORDER.map((c) => ({ text: `${CATEGORY_EMOJI[c]} ${CATEGORY_LABEL[c]}`, callback_data: `${prefix}:${c}` }))
  const rows: Keyboard = []
  for (let i = 0; i < btns.length; i += 2) rows.push(btns.slice(i, i + 2))
  if (extra.length) rows.push(extra)
  return rows
}

/** Kategori hutang/tabungan tanpa target spesifik → tanya yang mana. */
function pickerFor(
  txId: string,
  category: Category,
  debtId: string | null,
  goalId: string | null,
  debts: { id: string; name: string }[],
  goals: { id: string; name: string }[],
): { question: string; keyboard: Keyboard } | null {
  const list = category === 'debt' && !debtId ? debts : category === 'savings' && !goalId ? goals : null
  if (!list?.length) return null
  const op = category === 'debt' ? 'kd' : 'ks'
  const rows: Keyboard = list.slice(0, 8).map((x, i) => [{ text: x.name, callback_data: `${op}:${txId}:${i}` }])
  rows.push([
    { text: 'Lainnya', callback_data: `${op}:${txId}:-` },
    { text: '↩️ Batalkan', callback_data: `u:${txId}` },
  ])
  return { question: category === 'debt' ? '💳 Untuk hutang yang mana?' : '🐷 Masuk ke tabungan yang mana?', keyboard: rows }
}

// ================================================================== callback

async function onCallback(cq: TgCallback) {
  const msg = cq.message
  const data = cq.data ?? ''
  if (!msg) return await ack(cq.id)
  const acct = await getAccount(cq.from.id)
  if (!acct) return await ack(cq.id, 'Akun Telegram kamu belum terhubung.', true)

  const [op, id, arg] = data.split(':')
  const chatId = msg.chat.id

  // ---- pending (kategori belum diketahui)
  if (op === 'p') {
    const { data: p } = await db.from('telegram_pending').select('*').eq('id', id).maybeSingle()
    if (!p || p.household_id !== acct.household_id) return await ack(cq.id, 'Sudah tidak berlaku.')
    await db.from('telegram_pending').delete().eq('id', id)
    if (arg === 'x') {
      await edit(chatId, msg.message_id, `❌ <s>${escapeHtml((p.payload as ParsedTx).label)}</s> — tidak dicatat.`)
      return await ack(cq.id, 'Dibatalkan')
    }
    if (!CATEGORY_ORDER.includes(arg as Category)) return await ack(cq.id)
    const author = { ...acct, user_id: p.user_id }
    const tx = await insertTx(author, Number(p.chat_id), toNewTx(p.payload as ParsedTx, arg as Category))
    await showTx(chatId, msg.message_id, tx.id, acct.household_id)
    return await ack(cq.id, 'Tercatat ✅')
  }

  // ---- bayar dari pengingat
  if (op === 'b') return payDueItem(cq, acct, id)

  // ---- aksi pada transaksi
  const tx = await getTx(id)
  if (!tx || tx.household_id !== acct.household_id) {
    await editKeyboard(chatId, msg.message_id, [])
    return await ack(cq.id, 'Transaksi sudah tidak ada.')
  }

  if (op === 'u') {
    const ageH = (Date.now() - new Date(tx.created_at).getTime()) / 3600_000
    if (ageH > UNDO_HOURS) return await ack(cq.id, `Lewat ${UNDO_HOURS} jam — batalkan dari web.`, true)
    const before = await renderTx(tx, { prefix: '↩️' })
    await db.from('transactions').delete().eq('id', tx.id).eq('household_id', acct.household_id)
    await edit(chatId, msg.message_id, `<s>${stripTags(before)}</s>\nDibatalkan oleh ${escapeHtml(acct.name)}`)
    return await ack(cq.id, 'Dibatalkan')
  }

  if (op === 'c') {
    await editKeyboard(chatId, msg.message_id, categoryKeyboard(`k:${tx.id}`, [{ text: '« Kembali', callback_data: `r:${tx.id}` }]))
    return await ack(cq.id)
  }

  if (op === 'r') {
    await editKeyboard(chatId, msg.message_id, txKeyboard(tx.id))
    return await ack(cq.id)
  }

  if (op === 'k' && CATEGORY_ORDER.includes(arg as Category)) {
    await db
      .from('transactions')
      .update({ category: arg, budget_item_id: null, debt_id: null, savings_goal_id: null })
      .eq('id', tx.id)
      .eq('household_id', acct.household_id)
    await showTx(chatId, msg.message_id, tx.id, acct.household_id)
    return await ack(cq.id, `Kategori: ${CATEGORY_LABEL[arg as Category]}`)
  }

  if (op === 'kd' || op === 'ks') {
    const isDebt = op === 'kd'
    const list = isDebt ? await loadDebts(acct.household_id) : await loadGoals(acct.household_id)
    const target = arg === '-' ? null : list[Number(arg)]
    if (arg !== '-' && !target) return await ack(cq.id, 'Pilihan sudah berubah, coba lagi.')
    let itemId: string | null = null
    if (target) {
      const items = await loadItems(acct.household_id, tx.date)
      itemId = items.find((i) => (isDebt ? i.debt_id : i.savings_goal_id) === target.id)?.id ?? null
    }
    await db
      .from('transactions')
      .update(isDebt
        ? { debt_id: target?.id ?? null, budget_item_id: itemId ?? tx.budget_item_id }
        : { savings_goal_id: target?.id ?? null, budget_item_id: itemId ?? tx.budget_item_id })
      .eq('id', tx.id)
      .eq('household_id', acct.household_id)
    await showTx(chatId, msg.message_id, tx.id, acct.household_id, { skipPicker: true })
    return await ack(cq.id, target ? target.name : 'OK')
  }

  return await ack(cq.id)
}

const stripTags = (html: string) => html.replace(/<[^>]+>/g, '')

/** answerCallbackQuery yang ditunggu sampai selesai (runtime bisa berhenti setelah respons). */
async function ack(callbackId: string, text?: string, alert = false): Promise<void> {
  await answer(callbackId, text, alert)
}

async function showTx(chatId: number, messageId: number, txId: string, householdId: string, opts: { skipPicker?: boolean } = {}) {
  const tx = await getTx(txId)
  if (!tx) return
  let picker = null
  if (!opts.skipPicker) {
    const [debts, goals] = await Promise.all([loadDebts(householdId), loadGoals(householdId)])
    picker = pickerFor(tx.id, tx.category, tx.debt_id, tx.savings_goal_id, debts, goals)
  }
  const text = await renderTx(tx)
  await edit(chatId, messageId, picker ? `${text}\n\n${picker.question}` : text, picker?.keyboard ?? txKeyboard(tx.id))
}

async function payDueItem(cq: TgCallback, acct: Account, itemId: string) {
  const msg = cq.message!
  const { data: item } = await db.from('budget_items').select('*').eq('id', itemId).maybeSingle()
  if (!item || item.household_id !== acct.household_id) return await ack(cq.id, 'Item tidak ditemukan.')
  const today = todayWIB()
  const month = await loadMonthTx(acct.household_id, ymOf(today))
  const already = month.some(
    (t) => t.budget_item_id === item.id || (item.debt_id && t.debt_id === item.debt_id && !t.budget_item_id),
  )
  if (already) return await ack(cq.id, `${item.name} sudah tercatat bulan ini.`, true)
  const tx = await insertTx(acct, msg.chat.id, {
    date: today,
    amount: Number(item.amount),
    category: item.category,
    budget_item_id: item.id,
    debt_id: item.debt_id,
    savings_goal_id: item.savings_goal_id,
    note: null,
  })
  // Hilangkan tombol yang sudah dibayar dari pesan pengingat.
  const kb = (msg as unknown as { reply_markup?: { inline_keyboard: Keyboard } }).reply_markup?.inline_keyboard ?? []
  await editKeyboard(msg.chat.id, msg.message_id, kb.map((row) => row.filter((b) => b.callback_data !== `b:${itemId}`)).filter((r) => r.length))
  await send(msg.chat.id, await renderTx(tx), txKeyboard(tx.id))
  return await ack(cq.id, `${item.name} dicatat ✅`)
}

// ================================================================== perintah

async function onCommand(msg: TgMessage, text: string) {
  const [head, ...args] = text.split(/\s+/)
  const [cmdRaw, mention] = head.slice(1).split('@')
  if (mention && BOT_USERNAME && mention.toLowerCase() !== BOT_USERNAME) return // untuk bot lain
  const cmd = cmdRaw.toLowerCase()
  const chatId = msg.chat.id
  const group = isGroupChat(msg)

  if (cmd === 'start' || cmd === 'hubungkan') return linkWithCode(msg, args[0])
  if (cmd === 'bantuan' || cmd === 'help') return void (await send(chatId, HELP))

  const acct = await getAccount(msg.from!.id)
  if (!acct) return void (await send(chatId, NOT_LINKED, undefined, msg.message_id))
  if (group) {
    const g = await getGroup(chatId)
    if (!g || g.household_id !== acct.household_id) {
      return void (await send(chatId, 'Grup ini belum terhubung. Hubungkan dari web: <b>Pengaturan → Telegram → Hubungkan grup</b>.'))
    }
  }

  switch (cmd) {
    case 'ringkasan': return cmdSummary(chatId, acct)
    case 'hariini': return cmdToday(chatId, acct)
    case 'hutang': return cmdDebts(chatId, acct)
    case 'jatuhtempo': return cmdDue(chatId, acct)
    case 'batal': return cmdUndoLast(msg, acct)
    case 'putus': return cmdUnlink(msg, acct)
    default:
      await send(chatId, `Perintah tidak dikenal.\n\n${HELP}`)
  }
}

async function linkWithCode(msg: TgMessage, rawCode?: string) {
  const chatId = msg.chat.id
  const group = isGroupChat(msg)
  const code = (rawCode ?? '').trim().toUpperCase()
  if (!code) {
    const acct = await getAccount(msg.from!.id)
    if (acct) return void (await send(chatId, `Halo ${escapeHtml(acct.name)} 👋\n\n${HELP}`))
    return void (await send(chatId, group
      ? 'Halo! Hubungkan grup ini dari web: <b>Pengaturan → Telegram → Hubungkan grup</b>.'
      : `Halo! 👋\n${NOT_LINKED}`))
  }
  const { data: row } = await db
    .from('telegram_link_codes')
    .select('*')
    .eq('code', code)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  if (!row) return void (await send(chatId, '❌ Kode tidak valid atau sudah kedaluwarsa. Buat kode baru dari web.'))

  if (row.kind === 'account') {
    if (group) return void (await send(chatId, 'Kode akun harus dipakai di chat pribadi dengan bot, bukan di grup.'))
    await db.from('telegram_accounts').delete().or(`telegram_user_id.eq.${msg.from!.id},user_id.eq.${row.user_id}`)
    const { error } = await db.from('telegram_accounts').insert({
      user_id: row.user_id,
      household_id: row.household_id,
      telegram_user_id: msg.from!.id,
      chat_id: chatId,
      username: msg.from!.username ?? null,
      first_name: msg.from!.first_name,
    })
    if (error) throw error
    await db.from('telegram_link_codes').delete().eq('code', code)
    const name = await profileName(row.user_id, msg.from!.first_name)
    return void (await send(chatId, `✅ Terhubung sebagai <b>${escapeHtml(name)}</b>.\n\n${HELP}`))
  }

  // kind = group
  if (!group) return void (await send(chatId, 'Kode grup harus dipakai di dalam grup. Gunakan tombol "Hubungkan grup" di web.'))
  await db.from('telegram_groups').delete().or(`household_id.eq.${row.household_id},chat_id.eq.${chatId}`)
  const { error } = await db.from('telegram_groups').insert({
    chat_id: chatId,
    household_id: row.household_id,
    title: msg.chat.title ?? null,
    linked_by: row.user_id,
  })
  if (error) throw error
  await db.from('telegram_link_codes').delete().eq('code', code)
  const me = await tg<{ can_read_all_group_messages?: boolean }>('getMe', {})
  const privacyWarn = me && me.can_read_all_group_messages === false
    ? '\n\n⚠️ <b>Privacy mode bot masih aktif</b>, jadi bot hanya membaca perintah. Matikan di @BotFather → /setprivacy → Disable, lalu keluarkan & masukkan lagi bot ke grup ini.'
    : ''
  await send(chatId, `✅ Grup <b>${escapeHtml(msg.chat.title ?? '')}</b> terhubung ke rumah tangga.\nAnggota yang sudah menghubungkan akun Telegram bisa langsung mencatat di sini.${privacyWarn}\n\n${HELP}`)
}

async function cmdSummary(chatId: number, acct: Account) {
  const today = todayWIB()
  const ym = ymOf(today)
  const [items, txs] = await Promise.all([loadItems(acct.household_id, `${today.slice(0, 7)}-01`), loadMonthTx(acct.household_id, ym)])
  const plan = planTotals(items, ym)
  const actual = sumByCategory(txs)
  const lines = [`📊 <b>Ringkasan ${formatMonth(ym)}</b>`, '<i>realisasi / rencana</i>', '']
  for (const c of CATEGORY_ORDER) {
    lines.push(`${CATEGORY_EMOJI[c]} ${CATEGORY_LABEL[c]}: <b>${formatIDR(actual[c])}</b> / ${formatIDR(plan[c])}`)
  }
  const ba = balanceOf(actual)
  const bp = balanceOf(plan)
  lines.push('', `Sisa saldo: <b>${formatIDR(ba)}</b>${ba < 0 ? ' 🔴' : ''}`, `Sisa saldo rencana: ${formatIDR(bp)}${bp < 0 ? ' (defisit)' : ''}`)
  await send(chatId, lines.join('\n'))
}

async function cmdToday(chatId: number, acct: Account) {
  const today = todayWIB()
  const txs = (await loadMonthTx(acct.household_id, ymOf(today))).filter((t) => t.date === today)
  if (!txs.length) return void (await send(chatId, `Belum ada transaksi hari ini (${formatDay(today)}).`))
  const names = new Map<string, string>()
  for (const id of new Set(txs.map((t) => t.user_id).filter(Boolean) as string[])) names.set(id, await profileName(id))
  const itemNames = new Map<string, string>()
  const itemIds = [...new Set(txs.map((t) => t.budget_item_id).filter(Boolean) as string[])]
  if (itemIds.length) {
    const { data } = await db.from('budget_items').select('id, name').in('id', itemIds)
    for (const r of data ?? []) itemNames.set(r.id, r.name)
  }
  const out = txs.filter((t) => t.category !== 'income').reduce((s, t) => s + t.amount, 0)
  const inc = txs.filter((t) => t.category === 'income').reduce((s, t) => s + t.amount, 0)
  const lines = [`🗓️ <b>Hari ini — ${formatDay(today)}</b>`, '']
  for (const t of txs) {
    const title = (t.budget_item_id && itemNames.get(t.budget_item_id)) || t.note || CATEGORY_LABEL[t.category]
    lines.push(`${CATEGORY_EMOJI[t.category]} ${escapeHtml(title)} — ${t.category === 'income' ? '+' : ''}${formatIDR(t.amount)} · ${escapeHtml(names.get(t.user_id ?? '') ?? '')}`)
  }
  lines.push('', `Pengeluaran: <b>${formatIDR(out)}</b>${inc ? ` · Pemasukan: ${formatIDR(inc)}` : ''}`)
  await send(chatId, lines.join('\n'))
}

async function cmdDebts(chatId: number, acct: Account) {
  const debts = await loadDebts(acct.household_id)
  if (!debts.length) return void (await send(chatId, 'Tidak ada hutang aktif 🎉'))
  const lines = ['💳 <b>Sisa hutang</b>', '']
  let total = 0
  for (const d of debts) {
    const r = await debtRemaining(d.id)
    const remaining = r?.remaining ?? d.principal
    total += remaining
    const months = d.monthly_installment > 0 ? Math.ceil(remaining / d.monthly_installment) : null
    lines.push(`• ${escapeHtml(d.name)}: <b>${formatIDR(remaining)}</b>${remaining === 0 ? ' ✅ lunas' : months ? ` · ±${months} bln lagi` : ''}`)
  }
  lines.push('', `Total: <b>${formatIDR(total)}</b>`)
  await send(chatId, lines.join('\n'))
}

async function cmdDue(chatId: number, acct: Account) {
  const today = todayWIB()
  const ym = ymOf(today)
  const [items, txs] = await Promise.all([loadItems(acct.household_id, `${today.slice(0, 7)}-01`), loadMonthTx(acct.household_id, ym)])
  const due = dueEntries(items, txs, ym, today).filter((d) => d.status !== 'paid')
  if (!due.length) return void (await send(chatId, '✅ Semua tagihan & cicilan bulan ini sudah dibayar.'))
  const lines = [`⏰ <b>Belum dibayar — ${formatMonth(ym)}</b>`, '']
  for (const d of due) {
    lines.push(`${d.status === 'overdue' ? '🔴' : '⚪'} ${escapeHtml(d.item.name)} — ${formatIDR(d.item.amount)} · ${formatDay(d.date)}${d.status === 'overdue' ? ' (telat)' : ''}`)
  }
  const kb = due.slice(0, 8).map((d) => [{ text: `✅ Bayar ${d.item.name}`, callback_data: `b:${d.item.id}` }])
  await send(chatId, lines.join('\n'), kb)
}

async function cmdUndoLast(msg: TgMessage, acct: Account) {
  const since = new Date(Date.now() - UNDO_HOURS * 3600_000).toISOString()
  const { data: last } = await db
    .from('transactions')
    .select('*')
    .eq('household_id', acct.household_id)
    .eq('user_id', acct.user_id)
    .eq('source', 'telegram')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!last) return void (await send(msg.chat.id, `Tidak ada transaksi dari Telegram dalam ${UNDO_HOURS} jam terakhir.`))
  const text = await renderTx({ ...last, amount: Number(last.amount) }, { prefix: '↩️' })
  await db.from('transactions').delete().eq('id', last.id).eq('household_id', acct.household_id)
  await send(msg.chat.id, `<s>${stripTags(text)}</s>\nDibatalkan.`)
}

async function cmdUnlink(msg: TgMessage, acct: Account) {
  if (isGroupChat(msg)) {
    await db.from('telegram_groups').delete().eq('chat_id', msg.chat.id).eq('household_id', acct.household_id)
    return void (await send(msg.chat.id, 'Grup ini sudah diputus dari rumah tangga. Bot tidak akan mencatat di sini lagi.'))
  }
  await db.from('telegram_accounts').delete().eq('user_id', acct.user_id)
  await send(msg.chat.id, 'Akun Telegram kamu sudah diputus. Hubungkan lagi kapan saja dari web.')
}
