import { useMemo, useState } from 'react'
import { DownloadIcon, PlusIcon, ReceiptIcon, SearchIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { MonthPicker } from '@/components/app/AppLayout'
import { CategoryDot, EmptyState, PageHeader, Stat } from '@/components/app/bits'
import { memberName, useBudgetItems, useDebts, useHousehold, useSavingsGoals, useTransactions } from '@/hooks/api'
import { CATEGORIES, CATEGORY_MAP } from '@/lib/categories'
import { formatDayHeading, ymToInput } from '@/lib/dates'
import { formatIDR } from '@/lib/format'
import type { BudgetItem, Category, Transaction } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useMonth } from '@/providers/month'
import { useTransactionDialog } from '@/providers/transaction-dialog'

const EMPTY_TX: Transaction[] = []
const EMPTY_ITEMS: BudgetItem[] = []

export function TransactionsPage() {
  const { ym } = useMonth()
  const { openTransaction } = useTransactionDialog()
  const txs = useTransactions(ym)
  const items = useBudgetItems().data ?? EMPTY_ITEMS
  const debts = useDebts().data ?? []
  const goals = useSavingsGoals().data ?? []
  const household = useHousehold().data
  const showAuthor = (household?.members.length ?? 0) > 1
  const [filter, setFilter] = useState<Category | 'all'>('all')
  const [query, setQuery] = useState('')

  const nameOf = (t: Transaction) => {
    const it = items.find((i) => i.id === t.budget_item_id)
    const debt = debts.find((d) => d.id === t.debt_id)
    const goal = goals.find((g) => g.id === t.savings_goal_id)
    return it?.name ?? debt?.name ?? goal?.name ?? 'Lainnya'
  }

  const list = txs.data ?? EMPTY_TX
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return list.filter((t) => {
      if (filter !== 'all' && t.category !== filter) return false
      if (!q) return true
      const it = items.find((i) => i.id === t.budget_item_id)
      return (t.note ?? '').toLowerCase().includes(q) || (it?.name ?? '').toLowerCase().includes(q)
    })
  }, [list, filter, query, items])

  const groups = useMemo(() => {
    const map = new Map<string, Transaction[]>()
    for (const t of filtered) map.set(t.date, [...(map.get(t.date) ?? []), t])
    return [...map.entries()]
  }, [filtered])

  const income = list.filter((t) => t.category === 'income').reduce((s, t) => s + t.amount, 0)
  const out = list.filter((t) => t.category !== 'income').reduce((s, t) => s + t.amount, 0)

  function exportCsv() {
    const header = ['Tanggal', 'Nominal', 'Kategori', 'Item', 'Keterangan', 'Dicatat oleh']
    const rows = filtered.map((t) => [
      t.date,
      String(t.amount),
      CATEGORY_MAP[t.category].label,
      nameOf(t),
      t.note ?? '',
      memberName(household, t.user_id) ?? '',
    ])
    const csv = [header, ...rows].map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\r\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `transaksi-${ymToInput(ym)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <>
      <PageHeader
        title="Transaksi"
        description="Catatan realisasi pemasukan & pengeluaran."
        actions={
          <>
            <MonthPicker />
            <Button className="hidden md:inline-flex" onClick={() => openTransaction()}>
              <PlusIcon /> Catat
            </Button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label="Pemasukan" value={formatIDR(income)} />
        <Stat label="Pengeluaran" value={formatIDR(out)} />
        <Stat label="Selisih" value={formatIDR(income - out)} tone={income - out < 0 ? 'negative' : undefined} />
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative sm:w-64">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari keterangan / item" className="pl-8" />
        </div>
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" role="radiogroup" aria-label="Filter kategori">
          {(['all', ...CATEGORIES.map((c) => c.key)] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={filter === k}
              onClick={() => setFilter(k)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                filter === k ? 'border-foreground bg-foreground text-background' : 'hover:bg-muted',
              )}
            >
              {k !== 'all' && <CategoryDot category={k} />}
              {k === 'all' ? 'Semua' : CATEGORY_MAP[k].short}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" className="sm:ml-auto" onClick={exportCsv} disabled={filtered.length === 0}>
          <DownloadIcon /> CSV
        </Button>
      </div>

      {txs.isLoading ? (
        <div className="grid gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : txs.error ? (
        <p className="text-sm text-negative">{(txs.error as Error).message}</p>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<ReceiptIcon />}
          title={list.length === 0 ? 'Belum ada transaksi bulan ini' : 'Tidak ada yang cocok dengan filter'}
          description={list.length === 0 ? 'Catat pemasukan atau pengeluaran pertamamu.' : undefined}
          action={
            list.length === 0 && (
              <Button onClick={() => openTransaction()}>
                <PlusIcon /> Catat transaksi
              </Button>
            )
          }
        />
      ) : (
        <div className="grid gap-4">
          {groups.map(([date, rows]) => {
            const dayOut = rows.filter((t) => t.category !== 'income').reduce((s, t) => s + t.amount, 0)
            return (
              <section key={date}>
                <div className="mb-1.5 flex items-baseline justify-between px-1 text-xs text-muted-foreground">
                  <span className="font-medium">{formatDayHeading(date)}</span>
                  {dayOut > 0 && <span className="tabular">−{formatIDR(dayOut)}</span>}
                </div>
                <Card className="py-0">
                  <CardContent className="divide-y px-0">
                    {rows.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => openTransaction(t)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                      >
                        <CategoryDot category={t.category} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{nameOf(t)}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {CATEGORY_MAP[t.category].short}
                            {t.note ? ` · ${t.note}` : ''}
                            {showAuthor && memberName(household, t.user_id) ? ` · oleh ${memberName(household, t.user_id)}` : ''}
                          </span>
                        </span>
                        <span className={cn('text-sm font-medium tabular', t.category === 'income' && 'text-positive')}>
                          {t.category === 'income' ? '+' : '−'}
                          {formatIDR(t.amount)}
                        </span>
                      </button>
                    ))}
                  </CardContent>
                </Card>
              </section>
            )
          })}
        </div>
      )}
    </>
  )
}
