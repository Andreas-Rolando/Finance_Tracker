const idr = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
})

const plain = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 })

/** Rp 1.500.000 */
export function formatIDR(n: number): string {
  return idr.format(Math.round(n)).replace(/ /g, ' ')
}

/** 1.500.000 (tanpa "Rp") */
export function formatNumber(n: number): string {
  return plain.format(Math.round(n))
}

/** 1,5 jt / 750 rb — untuk label chart */
export function formatCompact(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000_000) return `${sign}${trim(abs / 1_000_000_000)} M`
  if (abs >= 1_000_000) return `${sign}${trim(abs / 1_000_000)} jt`
  if (abs >= 1_000) return `${sign}${trim(abs / 1_000)} rb`
  return `${sign}${abs}`
}

function trim(n: number): string {
  return n.toLocaleString('id-ID', { maximumFractionDigits: 1 })
}

/** "1.500.000" / "Rp 1.500.000" → 1500000. Kosong → null. */
export function parseNumber(s: string): number | null {
  const digits = s.replace(/[^\d]/g, '')
  if (!digits) return null
  return Number(digits)
}

export function percent(part: number, whole: number): number {
  if (whole <= 0) return part > 0 ? 100 : 0
  return (part / whole) * 100
}
