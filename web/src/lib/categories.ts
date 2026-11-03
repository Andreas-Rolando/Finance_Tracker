import type { Category } from './types'

export interface CategoryMeta {
  key: Category
  label: string
  short: string
  /** CSS variable holding the categorical series color (fixed order). */
  colorVar: string
}

/** Urutan tetap — sama dengan urutan di spreadsheet & palet kategorikal. */
export const CATEGORIES: CategoryMeta[] = [
  { key: 'income', label: 'Pendapatan', short: 'Pendapatan', colorVar: 'var(--series-1)' },
  { key: 'savings', label: 'Tabungan & Investasi', short: 'Tabungan', colorVar: 'var(--series-2)' },
  { key: 'bills', label: 'Tagihan', short: 'Tagihan', colorVar: 'var(--series-3)' },
  { key: 'household', label: 'Biaya Operasional Rumah Tangga', short: 'Rumah Tangga', colorVar: 'var(--series-4)' },
  { key: 'debt', label: 'Hutang', short: 'Hutang', colorVar: 'var(--series-5)' },
]

export const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.key, c])) as Record<
  Category,
  CategoryMeta
>

export const EXPENSE_CATEGORIES: Category[] = ['savings', 'bills', 'household', 'debt']
