// Akses database untuk Edge Function (service role → MELEWATI RLS).
// Setiap query WAJIB difilter household_id dari akun yang sudah terverifikasi.
import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  addDays,
  type BudgetItemRow,
  CATEGORY_EMOJI,
  CATEGORY_LABEL,
  type Category,
  escapeHtml,
  formatDay,
  formatIDR,
  monthEnd,
  monthStart,
  type TxRow,
  type YM,
} from './core.ts'

export const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const num = (v: unknown) => (v == null ? 0 : Number(v))

export interface Account {
  user_id: string
  household_id: string
  name: string
}

export async function getAccount(telegramUserId: number): Promise<Account | null> {
  const { data } = await db
    .from('telegram_accounts')
    .select('user_id, household_id, first_name')
    .eq('telegram_user_id', telegramUserId)
    .maybeSingle()
  if (!data) return null
  return { user_id: data.user_id, household_id: data.household_id, name: await profileName(data.user_id, data.first_name) }
}

export async function profileName(userId: string | null, fallback?: string | null): Promise<string> {
  if (!userId) return fallback ?? 'Anggota'
  const { data } = await db.from('profiles').select('full_name, email').eq('id', userId).maybeSingle()
  return (data?.full_name?.split(' ')[0] || fallback || data?.email?.split('@')[0] || 'Anggota') as string
}

export async function getGroup(chatId: number): Promise<{ chat_id: number; household_id: string } | null> {
  const { data } = await db.from('telegram_groups').select('chat_id, household_id').eq('chat_id', chatId).maybeSingle()
  return data ? { chat_id: Number(data.chat_id), household_id: data.household_id } : null
}

export async function householdGroupChat(householdId: string): Promise<number | null> {
  const { data } = await db.from('telegram_groups').select('chat_id').eq('household_id', householdId).maybeSingle()
  return data ? Number(data.chat_id) : null
}

export async function memberChats(householdId: string): Promise<number[]> {
  const { data } = await db.from('telegram_accounts').select('chat_id').eq('household_id', householdId)
  return (data ?? []).map((r) => Number(r.chat_id))
}

/** Tujuan notifikasi rumah tangga: grup keluarga kalau ada, kalau tidak chat pribadi tiap anggota. */
export async function targetChats(householdId: string): Promise<number[]> {
  const group = await householdGroupChat(householdId)
  return group ? [group] : await memberChats(householdId)
}

/** Transaksi pada rentang tanggal (inklusif). */
export async function loadTxRange(householdId: string, from: string, to: string): Promise<TxRow[]> {
  const { data, error } = await db
    .from('transactions')
    .select('id, date, amount, category, budget_item_id, debt_id, savings_goal_id, note, user_id')
    .eq('household_id', householdId)
    .gte('date', from)
    .lte('date', to)
    .order('date')
    .limit(5000)
  if (error) throw error
  return (data ?? []).map((t) => ({ ...t, amount: num(t.amount) })) as TxRow[]
}

const RATE_LIMIT_PER_MINUTE = 20

/**
 * Tandai update Telegram sudah diproses. `false` = duplikat (Telegram mengirim ulang)
 * → jangan diproses lagi supaya transaksi tidak tercatat dua kali.
 */
export async function claimUpdate(updateId: number, telegramUserId: number | null): Promise<boolean> {
  const { error } = await db.from('telegram_updates').insert({ update_id: updateId, telegram_user_id: telegramUserId })
  if (!error) return true
  if (error.code === '23505') return false
  console.error('claimUpdate gagal, tetap diproses', error.message)
  return true
}

/** Jumlah update dari user ini dalam 60 detik terakhir (termasuk yang barusan). */
export async function recentUpdateCount(telegramUserId: number): Promise<number> {
  const since = new Date(Date.now() - 60_000).toISOString()
  const { data } = await db
    .from('telegram_updates')
    .select('update_id')
    .eq('telegram_user_id', telegramUserId)
    .gte('received_at', since)
    .limit(RATE_LIMIT_PER_MINUTE + 5)
  return data?.length ?? 0
}
export { RATE_LIMIT_PER_MINUTE }

/** Item budget yang masih/pernah berlaku sejak `since`. */
export async function loadItems(householdId: string, since: string): Promise<BudgetItemRow[]> {
  const { data, error } = await db
    .from('budget_items')
    .select('id, name, category, amount, frequency, due_day, due_month, debt_id, savings_goal_id, effective_from, effective_to')
    .eq('household_id', householdId)
    .or(`effective_to.is.null,effective_to.gte.${since}`)
  if (error) throw error
  return (data ?? []).map((r) => ({ ...r, amount: num(r.amount) })) as BudgetItemRow[]
}

export async function loadDebts(householdId: string) {
  const { data, error } = await db
    .from('debts')
    .select('id, name, principal, monthly_installment')
    .eq('household_id', householdId)
    .eq('status', 'active')
    .order('created_at')
  if (error) throw error
  return (data ?? []).map((d) => ({ ...d, principal: num(d.principal), monthly_installment: num(d.monthly_installment) }))
}

export async function loadGoals(householdId: string) {
  const { data, error } = await db
    .from('savings_goals')
    .select('id, name, target_amount, initial_amount')
    .eq('household_id', householdId)
    .order('created_at')
  if (error) throw error
  return (data ?? []).map((g) => ({ ...g, target_amount: num(g.target_amount), initial_amount: num(g.initial_amount) }))
}

export async function loadMonthTx(householdId: string, ym: YM): Promise<TxRow[]> {
  const { data, error } = await db
    .from('transactions')
    .select('id, date, amount, category, budget_item_id, debt_id, savings_goal_id, note, user_id')
    .eq('household_id', householdId)
    .gte('date', monthStart(ym))
    .lte('date', monthEnd(ym))
    .order('date')
    .limit(5000)
  if (error) throw error
  return (data ?? []).map((t) => ({ ...t, amount: num(t.amount) })) as TxRow[]
}

export async function debtRemaining(debtId: string): Promise<{ name: string; remaining: number } | null> {
  const { data: d } = await db.from('debts').select('name, principal').eq('id', debtId).maybeSingle()
  if (!d) return null
  const { data: p } = await db.from('v_debt_paid').select('paid').eq('debt_id', debtId).maybeSingle()
  return { name: d.name, remaining: Math.max(num(d.principal) - num(p?.paid), 0) }
}

export interface FullTx extends TxRow {
  household_id: string
  created_at: string
  source: string
}

export async function getTx(id: string): Promise<FullTx | null> {
  const { data } = await db.from('transactions').select('*').eq('id', id).maybeSingle()
  return data ? ({ ...data, amount: num(data.amount) } as FullTx) : null
}

export interface NewTx {
  date: string
  amount: number
  category: Category
  budget_item_id: string | null
  debt_id: string | null
  savings_goal_id: string | null
  note: string | null
}

export async function insertTx(acct: Account, chatId: number, t: NewTx): Promise<FullTx> {
  const { data, error } = await db
    .from('transactions')
    .insert({ ...t, household_id: acct.household_id, user_id: acct.user_id, source: 'telegram', telegram_chat_id: chatId })
    .select('*')
    .single()
  if (error) throw error
  return { ...data, amount: num(data.amount) } as FullTx
}

/** Teks ringkas satu transaksi untuk balasan bot (HTML). */
export async function renderTx(tx: TxRow, opts: { prefix?: string } = {}): Promise<string> {
  const [item, debt, goal, author] = await Promise.all([
    tx.budget_item_id ? db.from('budget_items').select('name').eq('id', tx.budget_item_id).maybeSingle() : null,
    tx.debt_id ? debtRemaining(tx.debt_id) : null,
    tx.savings_goal_id ? db.from('savings_goals').select('name').eq('id', tx.savings_goal_id).maybeSingle() : null,
    profileName(tx.user_id),
  ])
  const title = item?.data?.name ?? debt?.name ?? goal?.data?.name ?? tx.note ?? CATEGORY_LABEL[tx.category]
  const lines = [
    `${opts.prefix ?? '✅'} <b>${escapeHtml(title)}</b> — ${formatIDR(tx.amount)}`,
    `${CATEGORY_EMOJI[tx.category]} ${CATEGORY_LABEL[tx.category]} · ${formatDay(tx.date)} · ${escapeHtml(author)}`,
  ]
  if (tx.note && tx.note !== title) lines.push(`📝 ${escapeHtml(tx.note)}`)
  if (debt) lines.push(`💳 Sisa hutang ${escapeHtml(debt.name)}: <b>${formatIDR(debt.remaining)}</b>`)
  return lines.join('\n')
}

/** Hapus antrean pending & kode kedaluwarsa (dipanggil sesekali). */
export async function cleanup() {
  const now = new Date().toISOString()
  await db.from('telegram_link_codes').delete().lt('expires_at', now)
  await db.from('telegram_pending').delete().lt('created_at', addDays(now.slice(0, 10), -1))
  await db.from('telegram_updates').delete().lt('received_at', addDays(now.slice(0, 10), -2))
}
