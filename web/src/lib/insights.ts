// Logika murni untuk dashboard: progres bulan, status laju, data grafik, insight otomatis.
import { CATEGORY_MAP } from './categories'
import { addDaysISO, daysInMonth, isoDate, ymOf, type YM } from './dates'
import { planItemsForMonth, type CategoryTotals, type DueEntry } from './finance'
import { formatIDR } from './format'
import type { BudgetItem, Transaction } from './types'

export type Tone = 'positive' | 'warning' | 'danger' | 'neutral'

export interface MonthProgress {
  state: 'past' | 'current' | 'future'
  /** Hari ke-berapa (current), total hari (past), 0 (future). */
  day: number
  days: number
  elapsedPct: number
}

export function monthProgress(ym: YM, today: string): MonthProgress {
  const days = daysInMonth(ym)
  const t = ymOf(today)
  const cmp = t.year * 12 + t.month - (ym.year * 12 + ym.month)
  if (cmp > 0) return { state: 'past', day: days, days, elapsedPct: 100 }
  if (cmp < 0) return { state: 'future', day: 0, days, elapsedPct: 0 }
  const day = Number(today.slice(8, 10))
  return { state: 'current', day, days, elapsedPct: Math.round((day / days) * 100) }
}

/**
 * Rencana pengeluaran kumulatif per hari yang MENGIKUTI JADWAL:
 * item bertanggal jatuh tempo (kontrakan, cicilan) dihitung penuh pada tanggalnya,
 * item tanpa tanggal (belanja, bensin) rata per hari. Index 0 = tanggal 1.
 */
export function plannedCurve(items: BudgetItem[], ym: YM): number[] {
  const days = daysInMonth(ym)
  const curve = new Array<number>(days).fill(0)
  for (const it of planItemsForMonth(items, ym)) {
    if (it.category === 'income' || it.amount <= 0) continue
    if (it.due_day != null) {
      for (let d = Math.min(it.due_day, days); d <= days; d++) curve[d - 1] += it.amount
    } else {
      for (let d = 1; d <= days; d++) curve[d - 1] += (it.amount * d) / days
    }
  }
  return curve.map(Math.round)
}

/**
 * Pengeluaran yang WAJAR sudah terjadi sampai tanggal `day`:
 * - komitmen (item bertanggal jatuh tempo, tabungan, cicilan) dihitung penuh setelah jatuh tempo,
 *   dan kalau sudah dibayar lebih awal, pembayaran itu juga dianggap wajar (bayar duluan ≠ boros);
 * - pengeluaran variabel tanpa tanggal (belanja, bensin) rata per hari, supaya belanja yang
 *   terlalu cepat tetap terdeteksi.
 */
export function expectedSpendToDate(items: BudgetItem[], transactions: Transaction[], ym: YM, day: number): number {
  const days = daysInMonth(ym)
  const cutoff = isoDate(ym.year, ym.month, Math.min(day, days))
  const planned = planItemsForMonth(items, ym).filter((i) => i.category !== 'income' && i.amount > 0)
  const byDebt = new Map(planned.filter((i) => i.debt_id).map((i) => [i.debt_id as string, i.id]))
  const byGoal = new Map(planned.filter((i) => i.savings_goal_id).map((i) => [i.savings_goal_id as string, i.id]))
  const paid = new Map<string, number>()
  for (const t of transactions) {
    if (t.category === 'income' || t.date > cutoff) continue
    const id = t.budget_item_id ?? (t.debt_id ? byDebt.get(t.debt_id) : undefined) ?? (t.savings_goal_id ? byGoal.get(t.savings_goal_id) : undefined)
    if (id) paid.set(id, (paid.get(id) ?? 0) + t.amount)
  }
  let total = 0
  for (const it of planned) {
    const scheduled = it.due_day != null ? (day >= Math.min(it.due_day, days) ? it.amount : 0) : (it.amount * day) / days
    const commitment = it.due_day != null || it.category === 'savings' || it.category === 'debt'
    total += commitment ? Math.max(scheduled, Math.min(paid.get(it.id) ?? 0, it.amount)) : scheduled
  }
  return Math.round(total)
}

/**
 * Status laju: realisasi s/d hari ini dibanding rencana yang wajar terpakai s/d hari ini
 * (lihat plannedCurve). Bulan lalu: total realisasi vs total rencana.
 */
export function paceStatus(
  actualToDate: number,
  expectedToDate: number,
  progress: MonthProgress,
  hasPlan: boolean,
): { tone: Tone; label: string } {
  if (!hasPlan) return { tone: 'neutral', label: 'Belum ada rencana pengeluaran' }
  if (progress.state === 'future') return { tone: 'neutral', label: 'Bulan belum berjalan' }
  if (progress.state === 'past') {
    return actualToDate > expectedToDate
      ? { tone: 'danger', label: 'Melebihi rencana' }
      : { tone: 'positive', label: 'Sesuai rencana' }
  }
  if (expectedToDate <= 0) {
    return actualToDate > 0
      ? { tone: 'warning', label: 'Ada pengeluaran sebelum jadwal' }
      : { tone: 'positive', label: 'Sesuai jadwal' }
  }
  const ratio = actualToDate / expectedToDate
  if (ratio > 1.15) return { tone: 'danger', label: 'Jauh lebih cepat dari jadwal' }
  if (ratio > 1.05) return { tone: 'warning', label: 'Sedikit lebih cepat dari jadwal' }
  if (ratio < 0.95) return { tone: 'positive', label: 'Lebih hemat dari jadwal' }
  return { tone: 'positive', label: 'Sesuai jadwal' }
}

/**
 * Pengeluaran kumulatif per hari (semua kategori kecuali pendapatan).
 * Index 0 = tanggal 1. Hari setelah `upToDay` bernilai null (belum terjadi).
 */
export function cumulativeExpenses(transactions: Transaction[], ym: YM, upToDay: number): (number | null)[] {
  const days = daysInMonth(ym)
  const perDay = new Array<number>(days).fill(0)
  for (const t of transactions) {
    if (t.category === 'income') continue
    const d = ymOf(t.date)
    if (d.year !== ym.year || d.month !== ym.month) continue
    perDay[Number(t.date.slice(8, 10)) - 1] += t.amount
  }
  let run = 0
  return perDay.map((v, i) => {
    run += v
    return i < upToDay ? run : null
  })
}

/** Total pengeluaran satu kategori pada rentang tanggal [from, to]. */
export function sumCategoryBetween(transactions: Transaction[], category: Transaction['category'], from: string, to: string): number {
  return transactions
    .filter((t) => t.category === category && t.date >= from && t.date <= to)
    .reduce((s, t) => s + t.amount, 0)
}

export interface Insight {
  tone: Tone
  icon: 'alert' | 'down' | 'up' | 'calendar' | 'check' | 'info'
  text: string
}

export function buildInsights(input: {
  progress: MonthProgress
  plan: CategoryTotals
  actual: CategoryTotals
  planBalance: number
  due: DueEntry[]
  today: string
  /** Pengeluaran Rumah Tangga 7 hari terakhir & 7 hari sebelumnya. */
  householdWeek: number
  householdPrevWeek: number
  hasItems: boolean
}): Insight[] {
  const out: Insight[] = []
  const { progress, plan, actual } = input

  if (input.hasItems && input.planBalance < 0) {
    out.push({ tone: 'danger', icon: 'alert', text: `Rencana bulan ini defisit ${formatIDR(Math.abs(input.planBalance))}` })
  }

  for (const c of ['bills', 'household'] as const) {
    if (plan[c] <= 0) continue
    const pct = Math.round((actual[c] / plan[c]) * 100)
    const label = CATEGORY_MAP[c].short
    if (pct >= 100) out.push({ tone: 'danger', icon: 'alert', text: `${label} melewati rencana (${pct}%)` })
    else if (pct >= 80) out.push({ tone: 'warning', icon: 'alert', text: `${label} sudah ${pct}% dari rencana` })
  }

  if (progress.state !== 'future') {
    const overdue = input.due.filter((d) => d.status === 'overdue').length
    const soon = input.due.filter((d) => d.status === 'upcoming' && d.date <= addDaysISO(input.today, 7)).length
    if (overdue) out.push({ tone: 'danger', icon: 'calendar', text: `${overdue} tagihan telat dibayar` })
    else if (soon && progress.state === 'current') {
      out.push({ tone: 'warning', icon: 'calendar', text: `${soon} tagihan jatuh tempo minggu ini` })
    }
  }

  if (progress.state === 'current' && input.householdPrevWeek > 0) {
    const change = Math.round(((input.householdWeek - input.householdPrevWeek) / input.householdPrevWeek) * 100)
    if (change <= -10) out.push({ tone: 'positive', icon: 'down', text: `Rumah Tangga minggu ini ${Math.abs(change)}% lebih hemat` })
    else if (change >= 20) out.push({ tone: 'warning', icon: 'up', text: `Rumah Tangga minggu ini ${change}% lebih boros` })
  }

  if (progress.state === 'current' && progress.day >= 5 && plan.income > 0 && actual.income === 0) {
    out.push({ tone: 'neutral', icon: 'info', text: 'Belum ada pemasukan tercatat bulan ini' })
  }

  if (!out.length && input.hasItems && progress.state !== 'future') {
    out.push({ tone: 'positive', icon: 'check', text: 'Keuangan bulan ini sesuai rencana' })
  }
  return out.slice(0, 3)
}

/** "Selamat pagi/siang/sore/malam" berdasarkan jam lokal. */
export function greeting(hour: number): string {
  if (hour >= 4 && hour < 11) return 'Selamat pagi'
  if (hour >= 11 && hour < 15) return 'Selamat siang'
  if (hour >= 15 && hour < 18) return 'Selamat sore'
  return 'Selamat malam'
}

