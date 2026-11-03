import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CategoryDot, PageHeader, Stat } from '@/components/app/bits'
import { useAnnualGoalMutations, useAnnualGoals, useBudgetItems, useMonthlyActuals, useMonthSettings } from '@/hooks/api'
import { CATEGORIES, CATEGORY_MAP } from '@/lib/categories'
import { currentYM, MONTH_NAMES, MONTH_SHORT } from '@/lib/dates'
import { actualTotalsFromRows, carryOverFor, planTotals, summarize, type CategoryTotals } from '@/lib/finance'
import { formatCompact, formatIDR } from '@/lib/format'
import type { Category } from '@/lib/types'
import { cn } from '@/lib/utils'

type Mode = 'actual' | 'plan'

export function AnnualPage() {
  const [year, setYear] = useState(currentYM().year)
  const [mode, setMode] = useState<Mode>('actual')
  const items = useBudgetItems()
  const actuals = useMonthlyActuals()
  const settings = useMonthSettings()

  const rows = MONTH_NAMES.map((_, i) => {
    const ym = { year, month: i + 1 }
    const plan = planTotals(items.data ?? [], ym)
    const actual = actualTotalsFromRows(actuals.data ?? [], ym)
    const carry = carryOverFor(ym, settings.data ?? [], actuals.data ?? [])
    return { ym, plan, actual, planS: summarize(plan, carry), actualS: summarize(actual, carry) }
  })

  const pick = (r: (typeof rows)[number]): CategoryTotals => (mode === 'actual' ? r.actual : r.plan)
  const yearTotal = (c: Category) => rows.reduce((s, r) => s + pick(r)[c], 0)
  const income = yearTotal('income')
  const out = yearTotal('savings') + yearTotal('bills') + yearTotal('household') + yearTotal('debt')

  const chartData = rows.map((r) => ({ month: MONTH_SHORT[r.ym.month - 1], ...pick(r) }))
  const loading = items.isLoading || actuals.isLoading || settings.isLoading

  return (
    <>
      <PageHeader
        title="Evaluasi tahunan"
        description="Gambaran 12 bulan: rencana vs realisasi per kategori."
        actions={
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => setYear(year - 1)} aria-label="Tahun sebelumnya">
              <ChevronLeftIcon />
            </Button>
            <span className="w-14 text-center text-sm font-medium tabular">{year}</span>
            <Button variant="outline" size="icon" onClick={() => setYear(year + 1)} aria-label="Tahun berikutnya">
              <ChevronRightIcon />
            </Button>
          </div>
        }
      />

      <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)} className="mb-4">
        <TabsList>
          <TabsTrigger value="actual">Realisasi</TabsTrigger>
          <TabsTrigger value="plan">Rencana</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label={`Pendapatan ${year}`} value={formatIDR(income)} />
        <Stat label={`Pengeluaran ${year}`} value={formatIDR(out)} sub="Termasuk tabungan & hutang" />
        <Stat label="Selisih" value={formatIDR(income - out)} tone={income - out < 0 ? 'negative' : 'positive'} />
      </div>

      {loading ? (
        <Skeleton className="h-80 rounded-xl" />
      ) : (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Pendapatan vs pengeluaran per bulan</CardTitle>
            <CardDescription>
              Batang biru: pendapatan. Batang bertumpuk: pengeluaran per kategori ({mode === 'actual' ? 'realisasi' : 'rencana'}).
            </CardDescription>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs">
              {CATEGORIES.map((c) => (
                <li key={c.key} className="flex items-center gap-1.5">
                  <CategoryDot category={c.key} /> {c.short}
                </li>
              ))}
            </ul>
          </CardHeader>
          <CardContent>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} barGap={2} barCategoryGap="22%" margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={48}
                    tickFormatter={(v: number) => formatCompact(v)}
                    tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                  />
                  <Tooltip
                    cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
                    contentStyle={{
                      background: 'var(--popover)',
                      color: 'var(--popover-foreground)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(value, name) => [formatIDR(Number(value)), CATEGORY_MAP[name as Category]?.short ?? String(name)]}
                  />
                  <Bar dataKey="income" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={18} />
                  {(['savings', 'bills', 'household', 'debt'] as const).map((c, i, arr) => (
                    <Bar
                      key={c}
                      dataKey={c}
                      stackId="out"
                      fill={CATEGORY_MAP[c].colorVar}
                      stroke="var(--card)"
                      strokeWidth={1}
                      radius={i === arr.length - 1 ? [4, 4, 0, 0] : 0}
                      maxBarSize={18}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Tabel bulanan</CardTitle>
          <CardDescription>Angka besar: realisasi · angka kecil: rencana.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm tabular">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="py-2 pr-3 text-left font-medium">Bulan</th>
                  {CATEGORIES.map((c) => (
                    <th key={c.key} className="px-2 py-2 text-right font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        <CategoryDot category={c.key} /> {c.short}
                      </span>
                    </th>
                  ))}
                  <th className="py-2 pl-2 text-right font-medium">Sisa saldo</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.ym.month} className="border-b last:border-0">
                    <td className="py-2 pr-3">{MONTH_NAMES[r.ym.month - 1]}</td>
                    {CATEGORIES.map((c) => (
                      <td key={c.key} className="px-2 py-2 text-right">
                        <div>{r.actual[c.key] ? formatCompact(r.actual[c.key]) : '—'}</div>
                        <div className="text-xs text-muted-foreground">{r.plan[c.key] ? formatCompact(r.plan[c.key]) : '—'}</div>
                      </td>
                    ))}
                    <td className="py-2 pl-2 text-right">
                      <div className={cn(r.actualS.balance < 0 && 'text-negative')}>{formatCompact(r.actualS.balance)}</div>
                      <div className={cn('text-xs text-muted-foreground', r.planS.balance < 0 && 'text-negative')}>
                        {formatCompact(r.planS.balance)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t font-semibold">
                  <td className="py-2 pr-3">Total</td>
                  {CATEGORIES.map((c) => (
                    <td key={c.key} className="px-2 py-2 text-right">
                      <div>{formatCompact(rows.reduce((s, r) => s + r.actual[c.key], 0))}</div>
                      <div className="text-xs font-normal text-muted-foreground">
                        {formatCompact(rows.reduce((s, r) => s + r.plan[c.key], 0))}
                      </div>
                    </td>
                  ))}
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>

      <AnnualGoals year={year} />
    </>
  )
}

function AnnualGoals({ year }: { year: number }) {
  const goals = useAnnualGoals(year)
  const { add, toggle, remove } = useAnnualGoalMutations(year)
  const [title, setTitle] = useState('')
  const list = goals.data ?? []
  const done = list.filter((g) => g.is_done).length

  return (
    <Card>
      <CardHeader>
        <CardTitle>Goal keuangan {year}</CardTitle>
        <CardDescription>
          {list.length ? `${done} dari ${list.length} tercapai` : 'Contoh: lunasi kartu kredit, mulai usaha sampingan, dana darurat 3× pengeluaran.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ul className="grid gap-1">
          {list.map((g) => (
            <li key={g.id} className="group flex items-center gap-3 rounded-lg px-1 py-1.5 hover:bg-muted/50">
              <Checkbox
                checked={g.is_done}
                onCheckedChange={(v) => toggle.mutate({ id: g.id, is_done: Boolean(v) })}
                aria-label={g.title}
              />
              <span className={cn('flex-1 text-sm', g.is_done && 'text-muted-foreground line-through')}>{g.title}</span>
              <Button
                variant="ghost"
                size="icon-xs"
                className="opacity-60 group-hover:opacity-100"
                aria-label={`Hapus ${g.title}`}
                onClick={() => remove.mutate(g.id)}
              >
                <Trash2Icon />
              </Button>
            </li>
          ))}
        </ul>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!title.trim()) return
            add.mutate(title.trim(), { onSuccess: () => setTitle('') })
          }}
        >
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Tambah goal…" />
          <Button type="submit" variant="outline" disabled={add.isPending || !title.trim()}>
            <PlusIcon /> Tambah
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
