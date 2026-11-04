// Fungsi murni yang dipakai Edge Function Telegram.
// Logika rumus SENGAJA sama dengan web/src/lib/finance.ts — kalau rumus di web
// berubah, sesuaikan juga di sini (test di web/src/lib/telegram-parser.test.ts).

export type Category = 'income' | 'savings' | 'bills' | 'household' | 'debt'

export const CATEGORY_LABEL: Record<Category, string> = {
  income: 'Pendapatan',
  savings: 'Tabungan',
  bills: 'Tagihan',
  household: 'Rumah Tangga',
  debt: 'Hutang',
}
export const CATEGORY_ORDER: Category[] = ['income', 'savings', 'bills', 'household', 'debt']
export const CATEGORY_EMOJI: Record<Category, string> = {
  income: '💰',
  savings: '🐷',
  bills: '🧾',
  household: '🛒',
  debt: '💳',
}

export interface BudgetItemRow {
  id: string
  name: string
  category: Category
  amount: number
  frequency: 'monthly' | 'yearly'
  due_day: number | null
  due_month: number | null
  debt_id: string | null
  savings_goal_id: string | null
  effective_from: string
  effective_to: string | null
}

export interface TxRow {
  id: string
  date: string
  amount: number
  category: Category
  budget_item_id: string | null
  debt_id: string | null
  savings_goal_id: string | null
  note: string | null
  user_id: string | null
}

// ------------------------------------------------------------------ tanggal

export interface YM {
  year: number
  month: number
}
const pad = (n: number) => String(n).padStart(2, '0')
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
export const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
]
const WEEKDAY = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']

/** Tanggal hari ini di Asia/Jakarta (WIB, UTC+7, tanpa DST). */
export function todayWIB(now = new Date()): string {
  return new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10)
}
export function isoDate(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`
}
export function daysInMonth({ year, month }: YM): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}
export function ymOf(date: string): YM {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) }
}
export function monthStart(ym: YM): string {
  return isoDate(ym.year, ym.month, 1)
}
export function monthEnd(ym: YM): string {
  return isoDate(ym.year, ym.month, daysInMonth(ym))
}
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export function addMonths(ym: YM, n: number): YM {
  const idx = ym.year * 12 + (ym.month - 1) + n
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 }
}
export function isValidDate(y: number, m: number, d: number): boolean {
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth({ year: y, month: m })
}
/** "Selasa, 3 Nov" */
export function formatDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  return `${WEEKDAY[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`
}
export function formatMonth(ym: YM): string {
  return `${MONTH_NAMES[ym.month - 1]} ${ym.year}`
}

// ------------------------------------------------------------------ uang

const idr = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 })
export function formatIDR(n: number): string {
  return `${n < 0 ? '-' : ''}Rp ${idr.format(Math.abs(Math.round(n)))}`
}

// ------------------------------------------------------------------ rumus (mirror web)

export type CategoryTotals = Record<Category, number>
export const emptyTotals = (): CategoryTotals => ({ income: 0, savings: 0, bills: 0, household: 0, debt: 0 })

/** Item berlaku pada tanggal tsb (abaikan frekuensi). */
export function isItemOnDate(item: BudgetItemRow, date: string): boolean {
  return item.effective_from <= date && (!item.effective_to || item.effective_to >= date)
}

export function isItemActiveInMonth(item: BudgetItemRow, ym: YM): boolean {
  if (item.effective_from > monthEnd(ym)) return false
  if (item.effective_to && item.effective_to < monthStart(ym)) return false
  if (item.frequency === 'yearly') return item.due_month === ym.month
  return true
}

export function planTotals(items: BudgetItemRow[], ym: YM): CategoryTotals {
  const t = emptyTotals()
  for (const i of items) if (isItemActiveInMonth(i, ym)) t[i.category] += i.amount
  return t
}

export function sumByCategory(rows: { category: Category; amount: number }[]): CategoryTotals {
  const t = emptyTotals()
  for (const r of rows) t[r.category] += r.amount
  return t
}

/** Sisa = Pendapatan − Ditabung − (Tagihan + Rumah Tangga) − Hutang */
export function balanceOf(t: CategoryTotals): number {
  return t.income - t.savings - t.bills - t.household - t.debt
}

export type DueStatus = 'paid' | 'upcoming' | 'overdue'
export interface DueEntry {
  item: BudgetItemRow
  date: string
  status: DueStatus
}

/** Sama dengan dueEntries di web. `transactions` = transaksi bulan `ym`. */
export function dueEntries(items: BudgetItemRow[], transactions: TxRow[], ym: YM, today: string): DueEntry[] {
  const last = daysInMonth(ym)
  return items
    .filter((i) => isItemActiveInMonth(i, ym) && i.category !== 'income' && i.due_day != null)
    .map((item) => {
      const date = isoDate(ym.year, ym.month, Math.min(item.due_day as number, last))
      const paid = transactions.some(
        (t) =>
          t.budget_item_id === item.id ||
          (item.debt_id != null && t.debt_id === item.debt_id && t.budget_item_id == null) ||
          (item.savings_goal_id != null && t.savings_goal_id === item.savings_goal_id && t.budget_item_id == null),
      )
      const status: DueStatus = paid ? 'paid' : date < today ? 'overdue' : 'upcoming'
      return { item, date, status }
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.item.name.localeCompare(b.item.name))
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
