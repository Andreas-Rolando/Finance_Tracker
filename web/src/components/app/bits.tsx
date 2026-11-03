import type { ReactNode } from 'react'
import { ArrowDownRightIcon, ArrowUpRightIcon } from 'lucide-react'
import { CATEGORY_MAP } from '@/lib/categories'
import { formatIDR } from '@/lib/format'
import type { Category } from '@/lib/types'
import { cn } from '@/lib/utils'

export function CategoryDot({ category, className }: { category: Category; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-2.5 shrink-0 rounded-full', className)}
      style={{ background: CATEGORY_MAP[category].colorVar }}
    />
  )
}

export function CategoryLabel({ category, short = true }: { category: Category; short?: boolean }) {
  const meta = CATEGORY_MAP[category]
  return (
    <span className="inline-flex items-center gap-1.5">
      <CategoryDot category={category} />
      {short ? meta.short : meta.label}
    </span>
  )
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center">
      {icon && <div className="mb-1 text-muted-foreground [&_svg]:size-8">{icon}</div>}
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/** Nominal bertanda: hijau + panah naik untuk positif, merah + panah turun untuk negatif. */
export function SignedAmount({ value, className }: { value: number; className?: string }) {
  const negative = value < 0
  const Icon = negative ? ArrowDownRightIcon : ArrowUpRightIcon
  return (
    <span className={cn('inline-flex items-center gap-1 tabular', negative ? 'text-negative' : 'text-positive', className)}>
      <Icon className="size-4" aria-hidden />
      {formatIDR(value)}
    </span>
  )
}

/** Progress bar ringan (rencana vs realisasi). Over-budget ditandai warna & label. */
export function Meter({
  value,
  max,
  color,
  over = 'negative',
  label,
}: {
  value: number
  max: number
  color?: string
  /** Kalau melebihi rencana: 'negative' (pengeluaran) atau 'positive' (pendapatan/tabungan) */
  over?: 'negative' | 'positive'
  label?: string
}) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : value > 0 ? 100 : 0
  const exceeded = max > 0 ? value > max : value > 0
  const fill = exceeded ? (over === 'negative' ? 'var(--negative)' : 'var(--positive)') : (color ?? 'var(--series-1)')
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
    >
      <div className="h-full rounded-full transition-[width]" style={{ width: `${pct}%`, background: fill }} />
    </div>
  )
}

export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'positive' | 'negative'
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-1 text-base font-semibold tracking-tight tabular sm:text-xl',
          tone === 'negative' && 'text-negative',
          tone === 'positive' && 'text-positive',
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground tabular">{sub}</p>}
    </div>
  )
}
