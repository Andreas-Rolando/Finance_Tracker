// Parser pesan Telegram → transaksi. Fungsi murni, tanpa I/O.
import { addDays, type BudgetItemRow, type Category, isItemOnDate, isoDate, isValidDate } from './core.ts'

export interface ParseContext {
  /** Hari ini (WIB), YYYY-MM-DD */
  today: string
  items: BudgetItemRow[]
  debts: { id: string; name: string }[]
  goals: { id: string; name: string }[]
}

export interface ParsedTx {
  amount: number
  date: string
  /** null = kategori belum diketahui → tanya user */
  category: Category | null
  budgetItemId: string | null
  debtId: string | null
  goalId: string | null
  /** Catatan bebas (deskripsi dari user) kalau berbeda dari nama item */
  note: string | null
  /** Judul singkat untuk balasan bot */
  label: string
}

export type ParseResult =
  | { ok: true; tx: ParsedTx; source: string }
  | { ok: false; error: 'no_amount'; source: string }

// ------------------------------------------------------------------ kamus

const INCOME_WORDS = [
  'gaji', 'gajian', 'bonus', 'thr', 'pemasukan', 'terima', 'diterima', 'transferan', 'cashback',
  'refund', 'komisi', 'dividen', 'masuk', 'penghasilan', 'pendapatan', 'honor', 'fee',
]

/** Kata kunci → kategori (dipakai kalau tidak ada item/hutang/tabungan yang cocok). */
const KEYWORDS: [Category, string[]][] = [
  ['debt', ['cicilan', 'angsuran', 'kredit', 'kartu kredit', 'cc', 'paylater', 'pinjol', 'hutang', 'utang', 'kpr', 'kta', 'pinjaman', 'spaylater', 'kredivo', 'akulaku']],
  ['savings', ['nabung', 'menabung', 'tabungan', 'investasi', 'reksadana', 'reksa dana', 'saham', 'emas', 'deposito', 'arisan', 'dana darurat']],
  ['bills', ['listrik', 'pln', 'token listrik', 'pdam', 'wifi', 'internet', 'indihome', 'pulsa', 'paket data', 'kuota', 'bpjs', 'asuransi', 'iuran', 'ipl', 'sewa', 'kontrakan', 'kos', 'kost', 'netflix', 'spotify', 'youtube', 'langganan', 'spp', 'sekolah', 'pajak', 'tagihan', 'telkom']],
  ['household', ['makan', 'makanan', 'minum', 'kopi', 'jajan', 'snack', 'sarapan', 'lunch', 'dinner', 'belanja', 'sayur', 'buah', 'beras', 'galon', 'gas', 'elpiji', 'lpg', 'bensin', 'pertalite', 'pertamax', 'bbm', 'solar', 'parkir', 'tol', 'ojol', 'gojek', 'grab', 'ojek', 'taksi', 'transport', 'kereta', 'krl', 'mrt', 'busway', 'sabun', 'deterjen', 'popok', 'susu', 'obat', 'apotek', 'dokter', 'laundry', 'cukur', 'hiburan', 'nonton', 'bioskop', 'indomaret', 'alfamart', 'supermarket', 'pasar', 'gofood', 'grabfood', 'shopee', 'tokopedia']],
]

const STOPWORDS = new Set([
  'bayar', 'beli', 'buat', 'untuk', 'utk', 'di', 'ke', 'dan', 'sama', 'tadi', 'nih', 'ya', 'aja', 'yang', 'yg',
  'dari', 'dr', 'setor', 'isi', 'top', 'up', 'topup', 'the', 'buat', 'pakai', 'pake', 'via', 'lagi', 'udah', 'sudah',
  'rp', 'hari', 'ini',
])

// ------------------------------------------------------------------ nominal

const AMOUNT_RE =
  /(^|[\s(+\-])(rp\.?\s*)?(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d+)?)\s*(rb|ribu|rebu|k|jt|juta)?(?=$|[\s),.!?;:])/gi

interface AmountHit {
  value: number
  start: number
  end: number
  strong: boolean // ada satuan atau "Rp"
}

function toNumber(raw: string, unit: string | undefined): number {
  const u = (unit ?? '').toLowerCase()
  const mult = u === 'rb' || u === 'ribu' || u === 'rebu' || u === 'k' ? 1e3 : u === 'jt' || u === 'juta' ? 1e6 : 1
  const grouped = /^\d{1,3}(?:[.,]\d{3})+$/.test(raw)
  let n: number
  if (grouped) n = Number(raw.replace(/[.,]/g, ''))
  else n = parseFloat(raw.replace(',', '.'))
  return Math.round(n * mult)
}

function findAmounts(s: string): AmountHit[] {
  const hits: AmountHit[] = []
  for (const m of s.matchAll(AMOUNT_RE)) {
    const lead = m[1] ?? ''
    const start = (m.index ?? 0) + lead.length
    const value = toNumber(m[3], m[4])
    if (!Number.isFinite(value) || value <= 0) continue
    hits.push({ value, start, end: (m.index ?? 0) + m[0].length, strong: Boolean(m[2] || m[4]) })
  }
  return hits
}

// ------------------------------------------------------------------ tanggal

const MONTH_WORDS: Record<string, number> = {
  jan: 1, januari: 1, feb: 2, februari: 2, mar: 3, maret: 3, apr: 4, april: 4, mei: 5, jun: 6, juni: 6,
  jul: 7, juli: 7, agu: 8, agt: 8, agustus: 8, sep: 9, sept: 9, september: 9, okt: 10, oktober: 10,
  nov: 11, november: 11, des: 12, desember: 12,
}

function extractDate(s: string, today: string): { date: string; rest: string } {
  const [ty, tm, td] = today.split('-').map(Number)
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => string | null) => {
    const m = s.match(re)
    if (!m) return null
    const d = fn(m)
    if (!d) return null
    return { date: d, rest: (s.slice(0, m.index) + ' ' + s.slice((m.index ?? 0) + m[0].length)).trim() }
  }
  return (
    take(/\bkemarin\s+lusa\b/i, () => addDays(today, -2)) ??
    take(/\bkemarin\b/i, () => addDays(today, -1)) ??
    take(/\bbesok\b/i, () => addDays(today, 1)) ??
    take(/\b(\d{1,2})\s+hari\s+(?:yang\s+|yg\s+)?lalu\b/i, (m) => addDays(today, -Number(m[1]))) ??
    take(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?\b/, (m) => {
      const d = Number(m[1]), mo = Number(m[2])
      let y = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : ty
      if (!isValidDate(y, mo, d)) return null
      // Tanpa tahun & lebih dari sebulan ke depan → maksudnya tahun lalu
      if (!m[3] && isoDate(y, mo, d) > addDays(today, 31)) y -= 1
      return isoDate(y, mo, d)
    }) ??
    take(/\b(?:tgl|tanggal)\.?\s*(\d{1,2})(?:\s+([a-z]+))?\b/i, (m) => {
      const d = Number(m[1])
      const named = m[2] ? MONTH_WORDS[m[2].toLowerCase()] : undefined
      let y = ty
      let mo = named ?? tm
      if (!named && d > td) mo -= 1 // "tgl 25" di awal bulan = bulan lalu
      if (mo < 1) { mo = 12; y -= 1 }
      return isValidDate(y, mo, d) ? isoDate(y, mo, d) : null
    }) ??
    take(/\bhari\s+ini\b/i, () => today) ?? { date: today, rest: s }
  )
}

// ------------------------------------------------------------------ pencocokan nama

const normalize = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
const tokens = (s: string) => normalize(s).split(' ').filter((t) => t.length >= 2 && !STOPWORDS.has(t))

function lev(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return dp[a.length][b.length]
}

const tokenMatch = (a: string, b: string) =>
  a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) || (a.length >= 5 && b.length >= 5 && lev(a, b) <= 1)

/** 0..1 seberapa cocok deskripsi dengan nama item/hutang/tabungan. */
export function nameScore(desc: string, name: string): number {
  const nd = ` ${normalize(desc)} `
  const nn = normalize(name)
  if (!nn) return 0
  if (nd.includes(` ${nn} `)) return 1
  const dt = tokens(desc)
  const nt = tokens(name)
  if (nt.length === 0 || dt.length === 0) return 0
  const matched = nt.filter((t) => dt.some((d) => tokenMatch(d, t))).length
  const descCovered = dt.filter((d) => nt.some((t) => tokenMatch(d, t))).length
  if (matched === 0) return 0
  // Semua kata deskripsi ada di nama ("listrik" → "Token Listrik") cukup kuat.
  if (descCovered === dt.length) return 0.9
  return 0.8 * (matched / nt.length)
}

/** Semua kata deskripsi sudah terwakili nama → catatan tidak perlu. */
function coveredBy(desc: string, name: string): boolean {
  const nt = tokens(name)
  return tokens(desc).every((d) => nt.some((t) => tokenMatch(d, t)))
}

function keywordCategory(desc: string): Category | null {
  const nd = ` ${normalize(desc)} `
  for (const [cat, words] of KEYWORDS) if (words.some((w) => nd.includes(` ${w} `))) return cat
  return null
}

const MIN_SCORE = 0.5

// ------------------------------------------------------------------ parse

function capitalize(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

export function parseLine(line: string, ctx: ParseContext): ParseResult {
  const source = line.trim()
  let s = source.replace(/\s+/g, ' ')
  let forceIncome = false
  let forceExpense = false
  if (s.startsWith('+')) { forceIncome = true; s = s.slice(1).trim() }
  else if (s.startsWith('-')) { forceExpense = true; s = s.slice(1).trim() }

  const { date, rest } = extractDate(s, ctx.today)
  s = rest

  const hits = findAmounts(s)
  const strong = hits.filter((h) => h.strong)
  const pick = strong.length ? strong[strong.length - 1] : hits.filter((h) => h.value >= 1000).sort((a, b) => b.value - a.value)[0]
  if (!pick) return { ok: false, error: 'no_amount', source }

  const desc = (s.slice(0, pick.start) + ' ' + s.slice(pick.end)).replace(/\brp\b\.?/gi, ' ').replace(/\s+/g, ' ').trim()
  const nd = ` ${normalize(desc)} `
  const isIncome = !forceExpense && (forceIncome || INCOME_WORDS.some((w) => nd.includes(` ${w} `)))

  const items = ctx.items.filter((i) => isItemOnDate(i, date))
  type Cand = { score: number; rank: number; category: Category; itemId: string | null; debtId: string | null; goalId: string | null; label: string }
  const cands: Cand[] = []

  if (!isIncome) {
    for (const d of ctx.debts) {
      const sc = nameScore(desc, d.name)
      if (sc >= MIN_SCORE) {
        const it = items.find((i) => i.debt_id === d.id)
        cands.push({ score: sc, rank: 3, category: 'debt', itemId: it?.id ?? null, debtId: d.id, goalId: null, label: d.name })
      }
    }
    for (const g of ctx.goals) {
      const sc = nameScore(desc, g.name)
      if (sc >= MIN_SCORE) {
        const it = items.find((i) => i.savings_goal_id === g.id)
        cands.push({ score: sc, rank: 2, category: 'savings', itemId: it?.id ?? null, debtId: null, goalId: g.id, label: g.name })
      }
    }
  }
  for (const i of items) {
    if (isIncome !== (i.category === 'income')) continue
    const sc = nameScore(desc, i.name)
    if (sc >= MIN_SCORE)
      cands.push({ score: sc, rank: 1, category: i.category, itemId: i.id, debtId: i.debt_id, goalId: i.savings_goal_id, label: i.name })
  }
  cands.sort((a, b) => b.score - a.score || b.rank - a.rank)
  const best = cands[0]

  const descLabel = capitalize(desc)
  if (best) {
    const sameAsName = coveredBy(desc, best.label)
    return {
      ok: true,
      source,
      tx: {
        amount: pick.value, date, category: best.category, budgetItemId: best.itemId, debtId: best.debtId,
        goalId: best.goalId, note: sameAsName || !desc ? null : descLabel, label: best.label,
      },
    }
  }

  const category: Category | null = isIncome ? 'income' : keywordCategory(desc)
  return {
    ok: true,
    source,
    tx: {
      amount: pick.value, date, category, budgetItemId: null, debtId: null, goalId: null,
      note: desc ? descLabel : null, label: desc ? descLabel : isIncome ? 'Pemasukan' : 'Transaksi',
    },
  }
}

/** Pecah pesan jadi beberapa transaksi: per baris / ";" / ", " dan beberapa nominal dalam satu baris. */
export function splitMessage(text: string): string[] {
  const parts: string[] = []
  for (const raw of text.split(/\n|;|,\s+(?=\D)/)) {
    const line = raw.trim()
    if (!line) continue
    // "bensin 50rb parkir 5rb" → dua transaksi (dipisah setelah tiap nominal bersatuan)
    const strong = findAmounts(line).filter((h) => h.strong)
    if (strong.length <= 1) { parts.push(line); continue }
    const hasWords = (seg: string) =>
      /\p{L}{2,}/u.test(seg.replace(/(?:rp\.?\s*)?\d+(?:[.,]\d+)*\s*(?:rb|ribu|rebu|k|jt|juta)?/gi, ''))
    // Pola "deskripsi nominal" → potong setelah tiap nominal; pola "nominal deskripsi" → potong sebelum.
    const cutAfter = strong.map((h, i) => line.slice(i === 0 ? 0 : strong[i - 1].end, h.end))
    const segs = cutAfter.every(hasWords)
      ? strong.map((h, i) => line.slice(i === 0 ? 0 : strong[i - 1].end, i === strong.length - 1 ? line.length : h.end))
      : strong.map((h, i) => line.slice(i === 0 ? 0 : h.start, i === strong.length - 1 ? line.length : strong[i + 1].start))
    for (const seg of segs) if (seg.trim()) parts.push(seg.trim())
  }
  return parts
}

export function parseMessage(text: string, ctx: ParseContext): ParseResult[] {
  return splitMessage(text).slice(0, 10).map((l) => parseLine(l, ctx))
}
