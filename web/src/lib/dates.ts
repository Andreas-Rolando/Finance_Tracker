/** Bulan kalender; month = 1..12 */
export interface YM {
  year: number
  month: number
}

const pad = (n: number) => String(n).padStart(2, '0')

export function daysInMonth({ year, month }: YM): number {
  return new Date(year, month, 0).getDate()
}

export function monthStart(ym: YM): string {
  return `${ym.year}-${pad(ym.month)}-01`
}

export function monthEnd(ym: YM): string {
  return `${ym.year}-${pad(ym.month)}-${pad(daysInMonth(ym))}`
}

export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`
}

/** Tambah n hari ke tanggal YYYY-MM-DD (tanpa efek zona waktu). */
export function addDaysISO(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function prevMonth({ year, month }: YM): YM {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
}

export function nextMonth({ year, month }: YM): YM {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 }
}

export function addMonths(ym: YM, n: number): YM {
  const idx = ym.year * 12 + (ym.month - 1) + n
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 }
}

export function compareYM(a: YM, b: YM): number {
  return a.year * 12 + a.month - (b.year * 12 + b.month)
}

export function currentYM(now = new Date()): YM {
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

/** Tanggal hari ini (zona waktu lokal) sebagai YYYY-MM-DD. */
export function todayISO(now = new Date()): string {
  return isoDate(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

export function ymOf(date: string): YM {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) }
}

/** "2026-11" ⇄ YM, untuk <input type="month"> */
export function ymToInput(ym: YM): string {
  return `${ym.year}-${pad(ym.month)}`
}
export function inputToYM(s: string): YM | null {
  const m = /^(\d{4})-(\d{2})$/.exec(s)
  return m ? { year: Number(m[1]), month: Number(m[2]) } : null
}

export const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
]
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
export const WEEKDAY_SHORT = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']

export function formatMonth(ym: YM): string {
  return `${MONTH_NAMES[ym.month - 1]} ${ym.year}`
}

/** "3 Nov 2026" */
export function formatDate(date: string): string {
  const { year, month } = ymOf(date)
  return `${Number(date.slice(8, 10))} ${MONTH_SHORT[month - 1]} ${year}`
}

/** "Selasa, 3 Nov" */
export function formatDayHeading(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  const weekday = d.toLocaleDateString('id-ID', { weekday: 'long' })
  return `${weekday}, ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`
}
