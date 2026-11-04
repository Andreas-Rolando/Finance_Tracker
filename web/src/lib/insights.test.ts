import { describe, expect, it } from 'vitest'
import { emptyTotals, type DueEntry } from './finance'
import { buildInsights, cumulativeExpenses, expectedSpendToDate, greeting, monthProgress, paceStatus, plannedCurve, sumCategoryBetween } from './insights'
import type { BudgetItem, Transaction } from './types'

const NOV = { year: 2026, month: 11 }
const tx = (date: string, amount: number, category: Transaction['category'] = 'household'): Transaction => ({
  id: date + amount, user_id: null, date, amount, category, budget_item_id: null, debt_id: null, savings_goal_id: null, note: null, created_at: '',
})
const due = (date: string, status: DueEntry['status']): DueEntry => ({
  item: { id: date, name: 'x' } as BudgetItem, date, day: Number(date.slice(8)), status, paidAmount: 0,
})

describe('monthProgress', () => {
  it('bulan berjalan / lalu / depan', () => {
    expect(monthProgress(NOV, '2026-11-12')).toEqual({ state: 'current', day: 12, days: 30, elapsedPct: 40 })
    expect(monthProgress(NOV, '2026-12-02')).toMatchObject({ state: 'past', elapsedPct: 100 })
    expect(monthProgress(NOV, '2026-10-30')).toMatchObject({ state: 'future', elapsedPct: 0 })
  })
})

describe('plannedCurve', () => {
  const item = (name: string, category: BudgetItem['category'], amount: number, due_day: number | null = null) =>
    ({ id: name, name, category, amount, frequency: 'monthly', due_day, due_month: null, debt_id: null, savings_goal_id: null, effective_from: '2026-01-01', effective_to: null, created_at: '' }) as BudgetItem
  it('item bertanggal penuh di tanggalnya, tanpa tanggal rata per hari, pendapatan diabaikan', () => {
    const c = plannedCurve([item('Kontrakan', 'bills', 1_000_000, 1), item('CC', 'debt', 600_000, 31), item('Belanja', 'household', 300_000), item('Gaji', 'income', 9_000_000, 1)], NOV)
    expect(c[0]).toBe(1_010_000)
    expect(c[14]).toBe(1_150_000)
    expect(c[29]).toBe(1_900_000)
  })
})

describe('expectedSpendToDate', () => {
  const item = (name: string, category: BudgetItem['category'], amount: number, due_day: number | null = null, x: Partial<BudgetItem> = {}) =>
    ({ id: name, name, category, amount, frequency: 'monthly', due_day, due_month: null, debt_id: null, savings_goal_id: null, effective_from: '2026-01-01', effective_to: null, created_at: '', ...x }) as BudgetItem
  const items = [
    item('Kontrakan', 'bills', 1_000_000, 1),
    item('KTA', 'debt', 1_250_000, 25, { debt_id: 'd3' }),
    item('Tabungan', 'savings', 600_000),
    item('Belanja', 'household', 1_500_000),
  ]
  it('bayar cicilan/tabungan lebih awal dianggap wajar; belanja tetap rata per hari', () => {
    const paid = [
      { ...tx('2026-11-02', 750_000, 'debt'), debt_id: 'd3' }, // KTA dibayar awal, tanpa budget_item_id
      { ...tx('2026-11-01', 600_000, 'savings'), budget_item_id: 'Tabungan' },
      { ...tx('2026-11-02', 900_000, 'household'), budget_item_id: 'Belanja' }, // belanja terlalu cepat
    ]
    // tgl 3: kontrakan 1jt + KTA 750rb (kredit bayar awal) + tabungan 600rb + belanja 1,5jt×3/30 = 150rb
    expect(expectedSpendToDate(items, paid, NOV, 3)).toBe(2_500_000)
  })
  it('pembayaran setelah tanggal acuan tidak dihitung', () => {
    expect(expectedSpendToDate(items, [{ ...tx('2026-11-10', 750_000, 'debt'), debt_id: 'd3' }], NOV, 3)).toBe(1_000_000 + 60_000 + 150_000)
  })
})

describe('paceStatus', () => {
  const cur = monthProgress(NOV, '2026-11-12')
  it.each([
    [1_100_000, 'warning', 'Sedikit lebih cepat dari jadwal'],
    [1_300_000, 'danger', 'Jauh lebih cepat dari jadwal'],
    [1_000_000, 'positive', 'Sesuai jadwal'],
    [800_000, 'positive', 'Lebih hemat dari jadwal'],
  ])('realisasi %d vs wajar 1jt', (actual, tone, label) => {
    expect(paceStatus(actual, 1_000_000, cur, true)).toEqual({ tone, label })
  })
  it('bulan lalu, tanpa rencana, belum ada jadwal', () => {
    expect(paceStatus(110, 100, monthProgress(NOV, '2026-12-01'), true).tone).toBe('danger')
    expect(paceStatus(90, 100, monthProgress(NOV, '2026-12-01'), true).tone).toBe('positive')
    expect(paceStatus(0, 0, cur, false).tone).toBe('neutral')
    expect(paceStatus(50, 0, cur, true).tone).toBe('warning')
  })
})

describe('cumulativeExpenses', () => {
  it('kumulatif per hari, tanpa pendapatan, null setelah hari ini', () => {
    const s = cumulativeExpenses([tx('2026-11-01', 100), tx('2026-11-03', 50), tx('2026-11-03', 9000, 'income'), tx('2026-10-31', 999)], NOV, 4)
    expect(s.slice(0, 5)).toEqual([100, 100, 150, 150, null])
    expect(s).toHaveLength(30)
  })
})

describe('buildInsights', () => {
  const base = {
    progress: monthProgress(NOV, '2026-11-12'),
    planBalance: 1_000_000,
    due: [] as DueEntry[],
    today: '2026-11-12',
    householdWeek: 0,
    householdPrevWeek: 0,
    hasItems: true,
  }
  it('peringatan kategori 80% / 100%, defisit, tagihan', () => {
    const plan = { ...emptyTotals(), bills: 1_000_000, household: 1_000_000, income: 5_000_000 }
    const actual = { ...emptyTotals(), bills: 920_000, household: 1_100_000, income: 5_000_000 }
    const r = buildInsights({ ...base, plan, actual, planBalance: -200_000, due: [due('2026-11-10', 'overdue')] })
    expect(r.map((i) => i.text)).toEqual([
      'Rencana bulan ini defisit Rp 200.000',
      'Tagihan sudah 92% dari rencana',
      'Rumah Tangga melewati rencana (110%)',
    ])
  })
  it('jatuh tempo minggu ini, tren mingguan, belum ada pemasukan', () => {
    const plan = { ...emptyTotals(), income: 5_000_000 }
    const r = buildInsights({ ...base, plan, actual: emptyTotals(), due: [due('2026-11-15', 'upcoming'), due('2026-11-30', 'upcoming')], householdWeek: 820_000, householdPrevWeek: 1_000_000 })
    expect(r.map((i) => [i.tone, i.text])).toEqual([
      ['warning', '1 tagihan jatuh tempo minggu ini'],
      ['positive', 'Rumah Tangga minggu ini 18% lebih hemat'],
      ['neutral', 'Belum ada pemasukan tercatat bulan ini'],
    ])
  })
  it('semua aman → satu insight positif', () => {
    expect(buildInsights({ ...base, plan: emptyTotals(), actual: emptyTotals() })).toEqual([
      { tone: 'positive', icon: 'check', text: 'Keuangan bulan ini sesuai rencana' },
    ])
  })
})

describe('lain-lain', () => {
  it('sumCategoryBetween & greeting', () => {
    expect(sumCategoryBetween([tx('2026-11-05', 10), tx('2026-11-09', 20), tx('2026-11-09', 5, 'bills')], 'household', '2026-11-06', '2026-11-12')).toBe(20)
    expect([greeting(6), greeting(12), greeting(16), greeting(21), greeting(2)]).toEqual(['Selamat pagi', 'Selamat siang', 'Selamat sore', 'Selamat malam', 'Selamat malam'])
  })
})
