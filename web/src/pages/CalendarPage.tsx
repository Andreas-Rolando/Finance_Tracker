import { CalendarDaysIcon } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { MonthPicker } from '@/components/app/AppLayout'
import { EmptyState, PageHeader, Stat } from '@/components/app/bits'
import { useBudgetItems, useTransactions } from '@/hooks/api'
import { CATEGORY_MAP } from '@/lib/categories'
import { daysInMonth, isoDate, todayISO, WEEKDAY_SHORT } from '@/lib/dates'
import { dueEntries } from '@/lib/finance'
import { formatIDR } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useMonth } from '@/providers/month'
import { useTransactionDialog } from '@/providers/transaction-dialog'
import { DueRow, prefillFromDue } from './DashboardPage'

export function CalendarPage() {
  const { ym } = useMonth()
  const { openTransaction } = useTransactionDialog()
  const items = useBudgetItems()
  const txs = useTransactions(ym)
  const today = todayISO()
  const entries = dueEntries(items.data ?? [], txs.data ?? [], ym, today)

  const total = daysInMonth(ym)
  // Senin = 0
  const lead = (new Date(ym.year, ym.month - 1, 1).getDay() + 6) % 7
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)]
  while (cells.length % 7) cells.push(null)

  const paid = entries.filter((e) => e.status === 'paid')
  const overdue = entries.filter((e) => e.status === 'overdue')
  const upcoming = entries.filter((e) => e.status === 'upcoming')
  const sum = (list: typeof entries) => list.reduce((s, e) => s + e.item.amount, 0)

  return (
    <>
      <PageHeader title="Kalender" description="Jadwal jatuh tempo tagihan, cicilan & setoran." actions={<MonthPicker />} />

      <div className="mb-6 grid grid-cols-3 gap-3">
        <Stat label="Sudah dibayar" value={paid.length} sub={formatIDR(sum(paid))} tone={paid.length ? 'positive' : undefined} />
        <Stat label="Telat" value={overdue.length} sub={formatIDR(sum(overdue))} tone={overdue.length ? 'negative' : undefined} />
        <Stat label="Belum jatuh tempo" value={upcoming.length} sub={formatIDR(sum(upcoming))} />
      </div>

      {items.isLoading || txs.isLoading ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<CalendarDaysIcon />}
          title="Belum ada jadwal jatuh tempo"
          description="Isi tanggal jatuh tempo pada item budget (tagihan, cicilan hutang, atau setoran tabungan)."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <Card>
            <CardContent>
              <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border text-xs">
                {WEEKDAY_SHORT.map((d) => (
                  <div key={d} className="bg-muted/60 py-1.5 text-center font-medium text-muted-foreground">
                    {d}
                  </div>
                ))}
                {cells.map((day, idx) => {
                  if (day == null) return <div key={`e${idx}`} className="min-h-14 bg-background sm:min-h-24" />
                  const date = isoDate(ym.year, ym.month, day)
                  const list = entries.filter((e) => e.day === day)
                  return (
                    <div key={date} className={cn('min-h-14 bg-background p-1 sm:min-h-24', date === today && 'bg-muted/50')}>
                      <div className={cn('mb-1 text-[11px] tabular', date === today ? 'font-semibold' : 'text-muted-foreground')}>
                        {day}
                      </div>
                      <div className="grid gap-0.5">
                        {list.map((e) => (
                          <button
                            key={e.item.id}
                            type="button"
                            title={`${e.item.name} · ${formatIDR(e.item.amount)}`}
                            onClick={() => e.status !== 'paid' && openTransaction(prefillFromDue(e))}
                            className={cn(
                              'flex items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[10px] leading-tight sm:text-[11px]',
                              e.status === 'paid' && 'text-muted-foreground line-through',
                              e.status === 'overdue' && 'bg-negative/10 font-medium text-negative',
                              e.status === 'upcoming' && 'bg-muted',
                            )}
                          >
                            <span
                              aria-hidden
                              className="size-1.5 shrink-0 rounded-full"
                              style={{ background: CATEGORY_MAP[e.item.category].colorVar }}
                            />
                            <span className="hidden truncate sm:inline">{e.item.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Daftar jatuh tempo</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {entries.map((e) => (
                  <DueRow key={e.item.id} entry={e} onPay={() => openTransaction(prefillFromDue(e))} />
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )
}
