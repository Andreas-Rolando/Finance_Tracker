import { AlertTriangleIcon, CheckCircle2Icon, ClockIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CategoryDot } from '@/components/app/bits'
import { addDaysISO, formatDate, todayISO } from '@/lib/dates'
import type { DueEntry } from '@/lib/finance'
import { formatIDR } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { TransactionPrefill } from '@/providers/transaction-dialog'

export function prefillFromDue(d: DueEntry): TransactionPrefill {
  return {
    date: d.status === 'overdue' ? todayISO() : d.date,
    amount: d.item.amount,
    category: d.item.category,
    budget_item_id: d.item.id,
    debt_id: d.item.debt_id,
    savings_goal_id: d.item.savings_goal_id,
  }
}

export function DueStatusBadge({ status }: { status: DueEntry['status'] }) {
  if (status === 'paid')
    return (
      <Badge variant="outline" className="gap-1 text-positive">
        <CheckCircle2Icon /> Lunas
      </Badge>
    )
  if (status === 'overdue')
    return (
      <Badge variant="outline" className="gap-1 text-negative">
        <AlertTriangleIcon /> Telat
      </Badge>
    )
  return (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <ClockIcon /> Belum
    </Badge>
  )
}

/** Baris jatuh tempo ringkas (dipakai di Kalender). */
export function DueRow({ entry, onPay }: { entry: DueEntry; onPay: () => void }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <CategoryDot category={entry.item.category} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{entry.item.name}</span>
        <span className="block text-xs text-muted-foreground tabular">
          {formatDate(entry.date)} · {formatIDR(entry.item.amount)}
        </span>
      </span>
      <DueStatusBadge status={entry.status} />
      {entry.status !== 'paid' && (
        <Button size="sm" variant="outline" onClick={onPay}>
          Bayar
        </Button>
      )}
    </li>
  )
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

/** Label hitung mundur + tingkat urgensi untuk timeline. */
export function dueCountdown(entry: DueEntry, today: string): { label: string; tone: 'danger' | 'warning' | 'neutral' | 'positive' } {
  if (entry.status === 'paid') return { label: 'Lunas', tone: 'positive' }
  const diff = daysBetween(today, entry.date)
  if (diff < 0) return { label: `Telat ${-diff} hari`, tone: 'danger' }
  if (diff === 0) return { label: 'Hari ini', tone: 'warning' }
  if (diff === 1) return { label: 'Besok', tone: 'warning' }
  return { label: `${diff} hari lagi`, tone: entry.date <= addDaysISO(today, 3) ? 'warning' : 'neutral' }
}

const TONE_BADGE = {
  danger: 'bg-negative/10 text-negative',
  warning: 'bg-warning/12 text-warning',
  neutral: 'bg-muted text-muted-foreground',
  positive: 'bg-positive/10 text-positive',
} as const

const TONE_DOT = {
  danger: 'bg-negative',
  warning: 'bg-warning',
  neutral: 'border-2 border-muted-foreground/50 bg-transparent',
  positive: 'bg-positive',
} as const

/** Timeline jatuh tempo untuk dashboard. */
export function DueTimeline({
  entries,
  today,
  money,
  onPay,
}: {
  entries: DueEntry[]
  today: string
  money: (n: number) => string
  onPay: (entry: DueEntry) => void
}) {
  return (
    <ol className="flex flex-col">
      {entries.map((e, i) => {
        const c = dueCountdown(e, today)
        const last = i === entries.length - 1
        return (
          <li key={e.item.id} className="flex gap-3.5">
            <div aria-hidden className="flex flex-col items-center">
              <span className={cn('mt-1 size-3 shrink-0 rounded-full', TONE_DOT[c.tone])} />
              {!last && <span className="w-0.5 flex-1 bg-border" />}
            </div>
            <div className={cn('flex min-w-0 flex-1 flex-wrap items-start justify-between gap-2', !last && 'pb-4')}>
              <div className="min-w-0">
                <p className={cn('truncate text-sm font-medium', e.status === 'paid' && 'text-muted-foreground line-through')}>
                  {e.item.name}
                </p>
                <p className="text-xs text-muted-foreground tabular">
                  {formatDate(e.date).replace(/ \d{4}$/, '')} · {money(e.item.amount)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold', TONE_BADGE[c.tone])}>
                  {c.tone === 'positive' && <CheckCircle2Icon className="size-3" aria-hidden />}
                  {c.label}
                </span>
                {e.status !== 'paid' && (
                  <Button size="sm" variant="outline" onClick={() => onPay(e)}>
                    Bayar
                  </Button>
                )}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
