import { describe, expect, it } from 'vitest'
import { parseLine, parseMessage, splitMessage, type ParseContext } from '../../../supabase/functions/_shared/parser.ts'
import { dueEntries, formatIDR, todayWIB, type BudgetItemRow } from '../../../supabase/functions/_shared/core.ts'

const item = (id: string, name: string, category: BudgetItemRow['category'], x: Partial<BudgetItemRow> = {}): BudgetItemRow => ({
  id, name, category, amount: 100_000, frequency: 'monthly', due_day: null, due_month: null,
  debt_id: null, savings_goal_id: null, effective_from: '2026-01-01', effective_to: null, ...x,
})

const ctx: ParseContext = {
  today: '2026-11-03',
  items: [
    item('gaji', 'Gaji', 'income'),
    item('listrik', 'Token Listrik', 'bills', { due_day: 20 }),
    item('wifi', 'Wifi', 'bills', { due_day: 3 }),
    item('belanja', 'Belanja Mingguan', 'household'),
    item('bensin', 'Bensin', 'household'),
    item('kopi', 'Kopi & Snack', 'household'),
    item('cc', 'Kartu Kredit', 'debt', { debt_id: 'd1', due_day: 15 }),
    item('darurat', 'Dana Darurat', 'savings', { savings_goal_id: 'g1' }),
    item('lama', 'Langganan Lama', 'bills', { effective_to: '2026-09-30' }),
  ],
  debts: [{ id: 'd1', name: 'Kartu Kredit' }, { id: 'd2', name: 'KTA Bank' }],
  goals: [{ id: 'g1', name: 'Dana Darurat' }],
}

const tx = (line: string) => {
  const r = parseLine(line, ctx)
  if (!r.ok) throw new Error(`no amount: ${line}`)
  return r.tx
}

describe('nominal', () => {
  it.each([
    ['bensin 50rb', 50_000],
    ['bensin 50 ribu', 50_000],
    ['bensin 50k', 50_000],
    ['bensin 50K', 50_000],
    ['gaji 9jt', 9_000_000],
    ['bayar kartu kredit 1,5jt', 1_500_000],
    ['bayar kartu kredit 1.5jt', 1_500_000],
    ['gaji 2 juta', 2_000_000],
    ['listrik 412.500', 412_500],
    ['listrik Rp 412.500', 412_500],
    ['listrik rp412.500', 412_500],
    ['parkir 5000', 5_000],
    ['beli 2 kopi 25rb', 25_000],
    ['beli 3 galon 21000', 21_000],
    ['cicilan 1.250.000', 1_250_000],
    ['35rb makan siang', 35_000],
  ])('%s → %d', (line, amount) => {
    expect(tx(line).amount).toBe(amount)
  })

  it('tanpa nominal yang jelas → minta ulang', () => {
    expect(parseLine('parkir 5', ctx)).toMatchObject({ ok: false, error: 'no_amount' })
    expect(parseLine('halo bot', ctx)).toMatchObject({ ok: false })
  })
})

describe('tanggal', () => {
  it.each([
    ['bensin 50rb', '2026-11-03'],
    ['kemarin bensin 50rb', '2026-11-02'],
    ['kemarin lusa belanja 120rb', '2026-11-01'],
    ['3 hari lalu bensin 50rb', '2026-10-31'],
    ['5/11 wifi 150rb', '2026-11-05'],
    ['28/10 wifi 150rb', '2026-10-28'],
    ['25/12 wifi 150rb', '2025-12-25'],
    ['tgl 1 wifi 150rb', '2026-11-01'],
    ['tgl 25 listrik 400rb', '2026-10-25'],
    ['tanggal 2 november listrik 400rb', '2026-11-02'],
  ])('%s → %s', (line, date) => {
    expect(tx(line).date).toBe(date)
  })

  it('angka tanggal tidak dianggap nominal', () => {
    expect(tx('5/11 wifi 150rb').amount).toBe(150_000)
  })
})

describe('kategori & item', () => {
  it('cocok dengan nama item budget', () => {
    expect(tx('bensin 50rb')).toMatchObject({ category: 'household', budgetItemId: 'bensin', note: null, label: 'Bensin' })
    expect(tx('listrik 400rb')).toMatchObject({ category: 'bills', budgetItemId: 'listrik', label: 'Token Listrik' })
    expect(tx('beli kopi 25rb')).toMatchObject({ budgetItemId: 'kopi', note: null })
    expect(tx('belanja 300rb')).toMatchObject({ budgetItemId: 'belanja' })
  })

  it('salah ketik ringan tetap cocok', () => {
    expect(tx('bensn 50rb').budgetItemId).toBe('bensin')
  })

  it('hutang → kurangi sisa hutang + item cicilannya', () => {
    expect(tx('bayar kartu kredit 1,5jt')).toMatchObject({ category: 'debt', debtId: 'd1', budgetItemId: 'cc', note: null })
    expect(tx('cicilan kta bank 1jt')).toMatchObject({ category: 'debt', debtId: 'd2', budgetItemId: null })
  })

  it('kata kunci hutang tanpa nama spesifik → kategori hutang, hutangnya ditanya', () => {
    expect(tx('bayar cicilan 500rb')).toMatchObject({ category: 'debt', debtId: null })
  })

  it('tabungan', () => {
    expect(tx('nabung dana darurat 500rb')).toMatchObject({ category: 'savings', goalId: 'g1', budgetItemId: 'darurat' })
  })

  it('pendapatan', () => {
    expect(tx('gaji 9jt')).toMatchObject({ category: 'income', budgetItemId: 'gaji' })
    expect(tx('+9jt')).toMatchObject({ category: 'income', budgetItemId: null, label: 'Pemasukan' })
    expect(tx('+ bonus proyek 2jt')).toMatchObject({ category: 'income' })
    expect(tx('transferan dari klien 3jt')).toMatchObject({ category: 'income' })
  })

  it('kata kunci umum tanpa item', () => {
    expect(tx('makan siang 35rb')).toMatchObject({ category: 'household', budgetItemId: null, note: 'Makan siang' })
    expect(tx('pulsa 50rb')).toMatchObject({ category: 'bills' })
    expect(tx('air galon 20rb')).toMatchObject({ category: 'household' })
  })

  it('tidak dikenali → kategori null (bot akan bertanya)', () => {
    expect(tx('kado ulang tahun 150rb')).toMatchObject({ category: null, label: 'Kado ulang tahun' })
    expect(tx('bayar 50rb')).toMatchObject({ category: null })
  })

  it('item yang sudah tidak berlaku tidak dipakai', () => {
    expect(tx('langganan lama 50rb').budgetItemId).toBeNull()
  })

  it('awalan "-" memaksa pengeluaran', () => {
    expect(tx('-gaji asisten 1jt').category).not.toBe('income')
  })
})

describe('beberapa transaksi sekaligus', () => {
  it('per baris & pemisah', () => {
    expect(splitMessage('bensin 50rb\nparkir 5rb')).toEqual(['bensin 50rb', 'parkir 5rb'])
    expect(splitMessage('bensin 50rb, parkir 5rb; kopi 20rb')).toEqual(['bensin 50rb', 'parkir 5rb', 'kopi 20rb'])
  })

  it('beberapa nominal dalam satu baris', () => {
    expect(splitMessage('bensin 50rb parkir 5rb')).toEqual(['bensin 50rb', 'parkir 5rb'])
    expect(splitMessage('50rb bensin 5rb parkir')).toEqual(['50rb bensin', '5rb parkir'])
  })

  it('koma desimal tidak memecah', () => {
    expect(splitMessage('kartu kredit 1,5jt')).toEqual(['kartu kredit 1,5jt'])
  })

  it('parseMessage maksimal 10 baris', () => {
    const r = parseMessage(Array.from({ length: 15 }, (_, i) => `jajan ${i + 1}rb`).join('\n'), ctx)
    expect(r).toHaveLength(10)
    expect(r.every((x) => x.ok)).toBe(true)
  })
})

describe('core', () => {
  it('format & tanggal WIB', () => {
    expect(formatIDR(1_500_000)).toBe('Rp 1.500.000')
    expect(formatIDR(-5000)).toBe('-Rp 5.000')
    expect(todayWIB(new Date('2026-11-02T17:30:00Z'))).toBe('2026-11-03') // 00:30 WIB
    expect(todayWIB(new Date('2026-11-02T16:59:00Z'))).toBe('2026-11-02')
  })

  it('dueEntries sama dengan versi web', () => {
    const res = dueEntries(ctx.items, [], { year: 2026, month: 11 }, '2026-11-10')
    expect(res.map((r) => [r.item.name, r.date, r.status])).toEqual([
      ['Wifi', '2026-11-03', 'overdue'],
      ['Kartu Kredit', '2026-11-15', 'upcoming'],
      ['Token Listrik', '2026-11-20', 'upcoming'],
    ])
  })
})
