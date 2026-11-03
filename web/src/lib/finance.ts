import { CATEGORIES } from './categories'
import {
  addMonths,
  daysInMonth,
  isoDate,
  monthEnd,
  monthStart,
  prevMonth,
  type YM,
} from './dates'
import type {
  BudgetItem,
  Category,
  Debt,
  MonthlyActual,
  MonthSetting,
  SavingsGoal,
  Transaction,
} from './types'

export type CategoryTotals = Record<Category, number>

export function emptyTotals(): CategoryTotals {
  return { income: 0, savings: 0, bills: 0, household: 0, debt: 0 }
}

// ---------------------------------------------------------------- Rencana

/** Apakah item ikut dalam rencana bulan `ym`. */
export function isItemActiveInMonth(item: BudgetItem, ym: YM): boolean {
  const start = monthStart(ym)
  const end = monthEnd(ym)
  if (item.effective_from > end) return false
  if (item.effective_to && item.effective_to < start) return false
  if (item.frequency === 'yearly') return item.due_month === ym.month
  return true
}

export function planItemsForMonth(items: BudgetItem[], ym: YM): BudgetItem[] {
  return items.filter((i) => isItemActiveInMonth(i, ym))
}

/** Item yang masih berlaku bulan ini atau nanti (dipakai halaman Budget). */
export function currentItems(items: BudgetItem[], current: YM): BudgetItem[] {
  const start = monthStart(current)
  return items.filter((i) => !i.effective_to || i.effective_to >= start)
}

export function sumByCategory(rows: { category: Category; amount: number }[]): CategoryTotals {
  const t = emptyTotals()
  for (const r of rows) t[r.category] += r.amount
  return t
}

export function planTotals(items: BudgetItem[], ym: YM): CategoryTotals {
  return sumByCategory(planItemsForMonth(items, ym))
}

/** Total rencana per bulan untuk item tahunan → berapa perlu disisihkan per bulan. */
export function monthlyEquivalent(item: BudgetItem): number {
  return item.frequency === 'yearly' ? Math.round(item.amount / 12) : item.amount
}

// ---------------------------------------------------------------- Realisasi

export function actualTotalsFromRows(rows: MonthlyActual[], ym: YM): CategoryTotals {
  const t = emptyTotals()
  for (const r of rows) if (r.year === ym.year && r.month === ym.month) t[r.category] += r.total
  return t
}

// ---------------------------------------------------------------- Gambaran umum

export interface MonthSummary {
  carry: number
  income: number
  savings: number
  /** Tagihan + Biaya Operasional Rumah Tangga */
  spent: number
  debt: number
  balance: number
}

/**
 * Sisa Saldo = Saldo Berlanjut + Pendapatan − Ditabung − Dibelanjakan − Hutang Dilunasi
 * (sama dengan rumus "Gambaran Umum" di spreadsheet)
 */
export function summarize(t: CategoryTotals, carry = 0): MonthSummary {
  const spent = t.bills + t.household
  return {
    carry,
    income: t.income,
    savings: t.savings,
    spent,
    debt: t.debt,
    balance: carry + t.income - t.savings - spent - t.debt,
  }
}

function isCarryOn(settings: MonthSetting[], ym: YM): boolean {
  return settings.some((s) => s.year === ym.year && s.month === ym.month && s.carry_over)
}

/**
 * Saldo berlanjut untuk bulan `ym`: kalau aktif, ambil Sisa Saldo realisasi bulan
 * sebelumnya (yang bisa juga membawa saldo dari bulan sebelumnya lagi).
 */
export function carryOverFor(ym: YM, settings: MonthSetting[], actuals: MonthlyActual[]): number {
  let carry = 0
  // Cari rantai bulan berturut-turut yang carry_over-nya aktif, mundur.
  const chain: YM[] = []
  let cursor = ym
  for (let guard = 0; guard < 1200 && isCarryOn(settings, cursor); guard++) {
    cursor = prevMonth(cursor)
    chain.push(cursor)
  }
  // Hitung maju dari bulan terlama di rantai.
  for (let i = chain.length - 1; i >= 0; i--) {
    carry = summarize(actualTotalsFromRows(actuals, chain[i]), carry).balance
  }
  return carry
}

// ---------------------------------------------------------------- Per item

export interface ItemProgress {
  key: string
  name: string
  category: Category
  plan: number
  actual: number
  item: BudgetItem | null
}

/** Rencana vs realisasi per item untuk satu bulan; transaksi tanpa item → "Lainnya". */
export function itemProgress(
  items: BudgetItem[],
  transactions: Transaction[],
  ym: YM,
): ItemProgress[] {
  const planned = planItemsForMonth(items, ym)
  const byItem = new Map<string, number>()
  const other = emptyTotals()
  const plannedIds = new Set(planned.map((i) => i.id))
  for (const tx of transactions) {
    if (tx.budget_item_id && plannedIds.has(tx.budget_item_id)) {
      byItem.set(tx.budget_item_id, (byItem.get(tx.budget_item_id) ?? 0) + tx.amount)
    } else {
      other[tx.category] += tx.amount
    }
  }
  const rows: ItemProgress[] = []
  for (const c of CATEGORIES) {
    for (const i of planned.filter((p) => p.category === c.key)) {
      rows.push({ key: i.id, name: i.name, category: c.key, plan: i.amount, actual: byItem.get(i.id) ?? 0, item: i })
    }
    if (other[c.key] > 0) {
      rows.push({ key: `other-${c.key}`, name: 'Lainnya', category: c.key, plan: 0, actual: other[c.key], item: null })
    }
  }
  return rows
}

// ---------------------------------------------------------------- Jatuh tempo

export type DueStatus = 'paid' | 'upcoming' | 'overdue'

export interface DueEntry {
  item: BudgetItem
  date: string
  day: number
  status: DueStatus
  paidAmount: number
}

/** Tagihan / cicilan / tabungan yang punya tanggal jatuh tempo di bulan `ym`. */
export function dueEntries(
  items: BudgetItem[],
  transactions: Transaction[],
  ym: YM,
  today: string,
): DueEntry[] {
  const last = daysInMonth(ym)
  return planItemsForMonth(items, ym)
    .filter((i) => i.category !== 'income' && i.due_day != null)
    .map((item) => {
      const day = Math.min(item.due_day as number, last)
      const date = isoDate(ym.year, ym.month, day)
      const paidAmount = transactions
        .filter(
          (t) =>
            t.budget_item_id === item.id ||
            (item.debt_id != null && t.debt_id === item.debt_id && t.budget_item_id == null) ||
            (item.savings_goal_id != null &&
              t.savings_goal_id === item.savings_goal_id &&
              t.budget_item_id == null),
        )
        .reduce((s, t) => s + t.amount, 0)
      const status: DueStatus = paidAmount > 0 ? 'paid' : date < today ? 'overdue' : 'upcoming'
      return { item, date, day, status, paidAmount }
    })
    .sort((a, b) => a.day - b.day || a.item.name.localeCompare(b.item.name))
}

// ---------------------------------------------------------------- Hutang

export interface DebtStatusInfo {
  paid: number
  remaining: number
  progress: number
  monthsLeft: number | null
  payoff: YM | null
  isPaidOff: boolean
}

export function debtStatus(debt: Debt, paid: number, from: YM): DebtStatusInfo {
  const remaining = Math.max(debt.principal - paid, 0)
  const progress = debt.principal > 0 ? Math.min((paid / debt.principal) * 100, 100) : 100
  const isPaidOff = remaining === 0
  let monthsLeft: number | null = null
  let payoff: YM | null = null
  if (isPaidOff) monthsLeft = 0
  else if (debt.monthly_installment > 0) {
    monthsLeft = Math.ceil(remaining / debt.monthly_installment)
    payoff = addMonths(from, monthsLeft - 1)
  }
  return { paid, remaining, progress, monthsLeft, payoff, isPaidOff }
}

export interface PayoffPlanRow {
  id: string
  name: string
  payoff: YM | null
  months: number | null
}

export interface PayoffSimulation {
  strategy: 'avalanche' | 'snowball'
  months: number | null
  debtFree: YM | null
  totalInterest: number
  order: PayoffPlanRow[]
}

/**
 * Simulasi pelunasan. Setiap bulan: tambah bunga, bayar cicilan minimum semua hutang,
 * lalu pembayaran tambahan + cicilan dari hutang yang sudah lunas dialokasikan ke
 * hutang prioritas (avalanche = bunga tertinggi, snowball = sisa terkecil).
 */
export function simulatePayoff(
  debts: { id: string; name: string; balance: number; installment: number; rate: number }[],
  extra: number,
  strategy: 'avalanche' | 'snowball',
  from: YM,
  maxMonths = 600,
): PayoffSimulation {
  const state = debts
    .filter((d) => d.balance > 0)
    .map((d) => ({ ...d, paidAt: null as number | null }))
  const budget = state.reduce((s, d) => s + d.installment, 0) + Math.max(extra, 0)
  let totalInterest = 0
  let month = 0
  while (state.some((d) => d.paidAt == null) && month < maxMonths) {
    month++
    const open = state.filter((d) => d.paidAt == null)
    for (const d of open) {
      const interest = d.balance * (d.rate / 100)
      totalInterest += interest
      d.balance += interest
    }
    let pool = budget
    for (const d of open) {
      const pay = Math.min(d.installment, d.balance, pool)
      d.balance -= pay
      pool -= pay
    }
    const prioritized = [...open].sort((a, b) =>
      strategy === 'avalanche' ? b.rate - a.rate || a.balance - b.balance : a.balance - b.balance || b.rate - a.rate,
    )
    for (const d of prioritized) {
      if (pool <= 0) break
      const pay = Math.min(d.balance, pool)
      d.balance -= pay
      pool -= pay
    }
    for (const d of open) if (d.balance <= 0.5) d.paidAt = month
    // Tidak ada progres sama sekali (budget 0) → berhenti.
    if (budget <= 0) break
  }
  const done = state.every((d) => d.paidAt != null)
  const months = done ? Math.max(0, ...state.map((d) => d.paidAt as number)) : null
  return {
    strategy,
    months,
    debtFree: months != null && months > 0 ? addMonths(from, months - 1) : months === 0 ? from : null,
    totalInterest: Math.round(totalInterest),
    order: [...state]
      .sort((a, b) => (a.paidAt ?? Infinity) - (b.paidAt ?? Infinity))
      .map((d) => ({
        id: d.id,
        name: d.name,
        months: d.paidAt,
        payoff: d.paidAt != null ? addMonths(from, d.paidAt - 1) : null,
      })),
  }
}

// ---------------------------------------------------------------- Tabungan

export interface SavingsStatusInfo {
  saved: number
  remaining: number
  progress: number
  monthsLeft: number | null
  eta: YM | null
}

export function savingsStatus(goal: SavingsGoal, paid: number, from: YM): SavingsStatusInfo {
  const saved = goal.initial_amount + paid
  const remaining = Math.max(goal.target_amount - saved, 0)
  const progress = Math.min((saved / goal.target_amount) * 100, 100)
  let monthsLeft: number | null = null
  let eta: YM | null = null
  if (remaining === 0) monthsLeft = 0
  else if (goal.monthly_plan > 0) {
    monthsLeft = Math.ceil(remaining / goal.monthly_plan)
    eta = addMonths(from, monthsLeft - 1)
  }
  return { saved, remaining, progress, monthsLeft, eta }
}

