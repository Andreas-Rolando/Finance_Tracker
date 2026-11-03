import { describe, expect, it } from 'vitest'
import {
  carryOverFor,
  debtStatus,
  dueEntries,
  isItemActiveInMonth,
  itemProgress,
  planTotals,
  savingsStatus,
  simulatePayoff,
  summarize,
} from './finance'
import { formatIDR, parseNumber } from './format'
import type { BudgetItem, Category, Debt, MonthlyActual, Transaction } from './types'

let seq = 0
function item(name: string, category: Category, amount: number, extra: Partial<BudgetItem> = {}): BudgetItem {
  return {
    id: `i${++seq}`,
    name,
    category,
    amount,
    frequency: 'monthly',
    due_day: null,
    due_month: null,
    debt_id: null,
    savings_goal_id: null,
    effective_from: '2026-01-01',
    effective_to: null,
    created_at: '',
    ...extra,
  }
}

function tx(date: string, category: Category, amount: number, extra: Partial<Transaction> = {}): Transaction {
  return {
    id: `t${++seq}`,
    user_id: null,
    date,
    amount,
    category,
    budget_item_id: null,
    debt_id: null,
    savings_goal_id: null,
    note: null,
    created_at: '',
    ...extra,
  }
}

const NOV = { year: 2026, month: 11 }

describe('rumus Gambaran Umum (sama dengan spreadsheet)', () => {
  // Data contoh. Rumus: Pendapatan − Ditabung − (Tagihan + Rumah Tangga) − Hutang
  const items = [
    item('Gaji', 'income', 10_000_000),
    item('Kontrakan', 'bills', 1_200_000),
    item('Listrik', 'bills', 500_000),
    item('Internet', 'bills', 150_000),
    item('Belanja', 'household', 2_000_000),
    item('Bensin', 'household', 300_000),
    item('Jajan', 'household', 250_000),
    item('Dana darurat', 'savings', 500_000),
    ...[1_500_000, 2_000_000, 750_000, 3_000_000, 1_250_000].map((a, i) => item(`Hutang ${i}`, 'debt', a)),
  ]

  it('menghitung total kategori & sisa saldo (bisa defisit)', () => {
    const t = planTotals(items, NOV)
    expect(t).toEqual({
      income: 10_000_000,
      savings: 500_000,
      bills: 1_850_000,
      household: 2_550_000,
      debt: 8_500_000,
    })
    const s = summarize(t)
    expect(s.spent).toBe(4_400_000)
    expect(s.balance).toBe(-3_400_000)
  })
})

describe('isItemActiveInMonth', () => {
  it('menghormati effective_from / effective_to', () => {
    const i = item('x', 'bills', 1, { effective_from: '2026-03-01', effective_to: '2026-06-30' })
    expect(isItemActiveInMonth(i, { year: 2026, month: 2 })).toBe(false)
    expect(isItemActiveInMonth(i, { year: 2026, month: 3 })).toBe(true)
    expect(isItemActiveInMonth(i, { year: 2026, month: 6 })).toBe(true)
    expect(isItemActiveInMonth(i, { year: 2026, month: 7 })).toBe(false)
  })

  it('item tahunan hanya muncul di bulan jatuh temponya', () => {
    const i = item('Pajak motor', 'bills', 600_000, { frequency: 'yearly', due_month: 8 })
    expect(isItemActiveInMonth(i, { year: 2026, month: 7 })).toBe(false)
    expect(isItemActiveInMonth(i, { year: 2026, month: 8 })).toBe(true)
    expect(isItemActiveInMonth(i, { year: 2027, month: 8 })).toBe(true)
  })
})

describe('carryOverFor', () => {
  const actuals: MonthlyActual[] = [
    { year: 2026, month: 9, category: 'income', total: 1_000 },
    { year: 2026, month: 9, category: 'household', total: 400 },
    { year: 2026, month: 10, category: 'income', total: 1_000 },
    { year: 2026, month: 10, category: 'bills', total: 300 },
  ]

  it('0 kalau tidak aktif', () => {
    expect(carryOverFor(NOV, [], actuals)).toBe(0)
  })

  it('mengambil sisa saldo realisasi bulan lalu', () => {
    const settings = [{ year: 2026, month: 11, carry_over: true }]
    expect(carryOverFor(NOV, settings, actuals)).toBe(700)
  })

  it('berantai kalau bulan lalu juga membawa saldo', () => {
    const settings = [
      { year: 2026, month: 11, carry_over: true },
      { year: 2026, month: 10, carry_over: true },
    ]
    expect(carryOverFor(NOV, settings, actuals)).toBe(600 + 700)
  })
})

describe('itemProgress', () => {
  it('mengelompokkan transaksi tanpa item ke "Lainnya"', () => {
    const listrik = item('Listrik', 'bills', 400_000)
    const rows = itemProgress(
      [listrik],
      [tx('2026-11-02', 'bills', 350_000, { budget_item_id: listrik.id }), tx('2026-11-03', 'household', 50_000)],
      NOV,
    )
    expect(rows).toEqual([
      expect.objectContaining({ name: 'Listrik', plan: 400_000, actual: 350_000 }),
      expect.objectContaining({ name: 'Lainnya', category: 'household', plan: 0, actual: 50_000 }),
    ])
  })
})

describe('dueEntries', () => {
  it('status lunas / telat / belum & tanggal dipotong ke akhir bulan', () => {
    const a = item('Kontrakan', 'bills', 1, { due_day: 1 })
    const b = item('Wifi', 'bills', 1, { due_day: 5 })
    const c = item('Kartu kredit', 'debt', 1, { due_day: 31 })
    const res = dueEntries([a, b, c], [tx('2026-11-01', 'bills', 1, { budget_item_id: a.id })], NOV, '2026-11-10')
    expect(res.map((r) => [r.item.name, r.date, r.status])).toEqual([
      ['Kontrakan', '2026-11-01', 'paid'],
      ['Wifi', '2026-11-05', 'overdue'],
      ['Kartu kredit', '2026-11-30', 'upcoming'],
    ])
  })
})

describe('debtStatus', () => {
  const debt: Debt = {
    id: 'd1',
    name: 'KTA',
    principal: 10_000_000,
    monthly_installment: 1_000_000,
    interest_rate_monthly: null,
    due_day: 10,
    start_date: null,
    tenor_months: null,
    status: 'active',
    created_at: '',
  }

  it('menghitung sisa & estimasi lunas', () => {
    const s = debtStatus(debt, 2_500_000, NOV)
    expect(s.remaining).toBe(7_500_000)
    expect(s.progress).toBe(25)
    expect(s.monthsLeft).toBe(8)
    expect(s.payoff).toEqual({ year: 2027, month: 6 })
  })

  it('lunas kalau pembayaran ≥ pokok', () => {
    expect(debtStatus(debt, 12_000_000, NOV)).toMatchObject({ remaining: 0, isPaidOff: true, monthsLeft: 0 })
  })
})

describe('simulatePayoff', () => {
  const debts = [
    { id: 'a', name: 'Besar bunga tinggi', balance: 5_000_000, installment: 500_000, rate: 3 },
    { id: 'b', name: 'Kecil bunga rendah', balance: 1_000_000, installment: 200_000, rate: 1 },
  ]

  it('avalanche tidak lebih mahal dari snowball', () => {
    const av = simulatePayoff(debts, 300_000, 'avalanche', NOV)
    const sb = simulatePayoff(debts, 300_000, 'snowball', NOV)
    expect(av.months).not.toBeNull()
    expect(sb.months).not.toBeNull()
    expect(av.totalInterest).toBeLessThanOrEqual(sb.totalInterest)
    expect(sb.order[0].id).toBe('b')
  })

  it('tanpa bunga & tanpa tambahan = sisa / cicilan', () => {
    const r = simulatePayoff([{ id: 'x', name: 'x', balance: 1_000, installment: 250, rate: 0 }], 0, 'avalanche', NOV)
    expect(r.months).toBe(4)
    expect(r.debtFree).toEqual({ year: 2027, month: 2 })
  })

  it('tidak pernah lunas kalau bunga > cicilan', () => {
    const r = simulatePayoff([{ id: 'x', name: 'x', balance: 1_000_000, installment: 1_000, rate: 5 }], 0, 'avalanche', NOV, 120)
    expect(r.months).toBeNull()
  })
})

describe('savingsStatus', () => {
  it('progress & ETA', () => {
    const s = savingsStatus(
      { id: 'g', name: 'Dana darurat', target_amount: 10_000_000, initial_amount: 1_000_000, monthly_plan: 1_000_000, target_date: null, created_at: '' },
      2_000_000,
      NOV,
    )
    expect(s.saved).toBe(3_000_000)
    expect(s.monthsLeft).toBe(7)
    expect(s.eta).toEqual({ year: 2027, month: 5 })
  })
})

describe('format', () => {
  it('rupiah', () => {
    expect(formatIDR(1_500_000)).toBe('Rp 1.500.000')
    expect(parseNumber('Rp 1.500.000')).toBe(1_500_000)
    expect(parseNumber('')).toBeNull()
  })
})
