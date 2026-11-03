import { Link } from 'react-router'
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleIcon,
  ClockIcon,
  CreditCardIcon,
  PiggyBankIcon,
  ReceiptIcon,
  WalletIcon,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { MonthPicker } from '@/components/app/AppLayout'
import { CategoryDot, Meter, PageHeader, Stat } from '@/components/app/bits'
import {
  useBudgetItems,
  useDebts,
  useMonthlyActuals,
  useMonthSettings,
  useSavingsGoals,
  useSetCarryOver,
  useTransactions,
} from '@/hooks/api'
import { CATEGORIES, CATEGORY_MAP } from '@/lib/categories'
import { formatDate, formatMonth, prevMonth, todayISO } from '@/lib/dates'
import { carryOverFor, dueEntries, planTotals, sumByCategory, summarize, type DueEntry } from '@/lib/finance'
import { formatIDR, percent } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useMonth } from '@/providers/month'
import { useTransactionDialog } from '@/providers/transaction-dialog'

export function DashboardPage() {
  const { ym } = useMonth()
  const { openTransaction } = useTransactionDialog()
  const items = useBudgetItems()
  const txs = useTransactions(ym)
  const debts = useDebts()
  const goals = useSavingsGoals()
  const actuals = useMonthlyActuals()
  const settings = useMonthSettings()
  const setCarry = useSetCarryOver()

  const loading = items.isLoading || txs.isLoading || actuals.isLoading || settings.isLoading
  const error = items.error || txs.error || actuals.error || settings.error

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTriangleIcon />
        <AlertTitle>Gagal memuat data</AlertTitle>
        <AlertDescription>{(error as Error).message}</AlertDescription>
      </Alert>
    )
  }

  const itemList = items.data ?? []
  const txList = txs.data ?? []
  const carryOn = (settings.data ?? []).some((s) => s.year === ym.year && s.month === ym.month && s.carry_over)
  const carry = carryOverFor(ym, settings.data ?? [], actuals.data ?? [])
  const planT = planTotals(itemList, ym)
  const actualT = sumByCategory(txList)
  const plan = summarize(planT, carry)
  const actual = summarize(actualT, carry)
  const today = todayISO()
  const due = dueEntries(itemList, txList, ym, today)
  const unpaid = due.filter((d) => d.status !== 'paid')
  const isNewUser = !loading && itemList.length === 0 && (debts.data ?? []).length === 0 && (goals.data ?? []).length === 0

  const outPlan = plan.savings + plan.spent + plan.debt
  const outActual = actual.savings + actual.spent + actual.debt

  return (
    <>
      <PageHeader title="Dashboard" description="Rencana vs realisasi bulan ini." actions={<MonthPicker />} />

      {isNewUser && <Onboarding />}

      {!loading && itemList.length > 0 && plan.balance < 0 && (
        <Alert variant="destructive" className="mb-6">
          <AlertTriangleIcon />
          <AlertTitle>Rencana bulan ini defisit {formatIDR(Math.abs(plan.balance))}</AlertTitle>
          <AlertDescription>
            Total rencana pengeluaran ({formatIDR(outPlan)}) melebihi pendapatan ({formatIDR(plan.income)}). Tinjau
            kembali budget atau cicilan hutang.
          </AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Pendapatan" value={formatIDR(actual.income)} sub={`Rencana ${formatIDR(plan.income)}`} />
          <Stat label="Pengeluaran" value={formatIDR(outActual)} sub={`Rencana ${formatIDR(outPlan)}`} />
          <Stat
            label="Sisa saldo (realisasi)"
            value={formatIDR(actual.balance)}
            tone={actual.balance < 0 ? 'negative' : undefined}
            sub={carry !== 0 ? `Termasuk saldo berlanjut ${formatIDR(carry)}` : 'Pendapatan − semua pengeluaran'}
          />
          <Stat
            label="Sisa saldo (rencana)"
            value={formatIDR(plan.balance)}
            tone={plan.balance < 0 ? 'negative' : undefined}
            sub={plan.balance < 0 ? 'Defisit' : 'Surplus'}
          />
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Gambaran umum</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-xs sm:text-sm [&_td+td]:pl-2 [&_td+td]:whitespace-nowrap">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="pb-2 text-left font-medium" />
                  <th className="pb-2 text-right font-medium">Rencana</th>
                  <th className="pb-2 text-right font-medium">Realisasi</th>
                </tr>
              </thead>
              <tbody className="tabular">
                <tr className="border-b">
                  <td className="py-2">
                    <label className="flex items-center gap-2">
                      <Switch
                        size="sm"
                        checked={carryOn}
                        disabled={setCarry.isPending}
                        onCheckedChange={(checked) => setCarry.mutate({ ym, carry_over: checked })}
                      />
                      <span>
                        Saldo berlanjut
                        <span className="block text-xs text-muted-foreground">dari {formatMonth(prevMonth(ym))}</span>
                      </span>
                    </label>
                  </td>
                  <td className="py-2 text-right">{carryOn ? formatIDR(carry) : '—'}</td>
                  <td className="py-2 text-right">{carryOn ? formatIDR(carry) : '—'}</td>
                </tr>
                <SummaryRow sign="+" label="Pendapatan" plan={plan.income} actual={actual.income} />
                <SummaryRow sign="−" label="Ditabung" plan={plan.savings} actual={actual.savings} />
                <SummaryRow sign="−" label="Dibelanjakan" hint="Tagihan + rumah tangga" plan={plan.spent} actual={actual.spent} />
                <SummaryRow sign="−" label="Hutang dibayar" plan={plan.debt} actual={actual.debt} />
                <tr className="font-semibold">
                  <td className="pt-3">Sisa saldo</td>
                  <td className={cn('pt-3 text-right', plan.balance < 0 && 'text-negative')}>{formatIDR(plan.balance)}</td>
                  <td className={cn('pt-3 text-right', actual.balance < 0 && 'text-negative')}>{formatIDR(actual.balance)}</td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Per kategori</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {CATEGORIES.map((c) => {
              const p = planT[c.key]
              const a = actualT[c.key]
              const isIncomeLike = c.key === 'income' || c.key === 'savings'
              return (
                <div key={c.key} className="grid gap-1.5">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2 font-medium">
                      <CategoryDot category={c.key} /> {c.short}
                    </span>
                    <span className="text-xs text-muted-foreground tabular">
                      <span className="text-foreground">{formatIDR(a)}</span> / {formatIDR(p)}
                    </span>
                  </div>
                  <Meter
                    value={a}
                    max={p}
                    color={c.colorVar}
                    over={isIncomeLike ? 'positive' : 'negative'}
                    label={`${c.short}: ${formatIDR(a)} dari rencana ${formatIDR(p)}`}
                  />
                  {!isIncomeLike && p > 0 && a > p && (
                    <p className="text-xs text-negative">Melebihi rencana {formatIDR(a - p)}</p>
                  )}
                  {p > 0 && !(a > p && !isIncomeLike) && (
                    <p className="text-xs text-muted-foreground tabular">{Math.round(percent(a, p))}% dari rencana</p>
                  )}
                </div>
              )
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Jatuh tempo bulan ini</CardTitle>
            <CardAction>
              <Link to="/kalender" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                Kalender
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            {due.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Belum ada tagihan/cicilan dengan tanggal jatuh tempo. Tambahkan tanggal di halaman Budget.
              </p>
            ) : unpaid.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-positive">
                <CheckCircle2Icon className="size-4" /> Semua tagihan bulan ini sudah dibayar.
              </p>
            ) : (
              <ul className="divide-y">
                {unpaid.slice(0, 6).map((d) => (
                  <DueRow key={d.item.id} entry={d} onPay={() => openTransaction(prefillFromDue(d))} />
                ))}
              </ul>
            )}
            {unpaid.length > 6 && (
              <p className="mt-2 text-xs text-muted-foreground">+{unpaid.length - 6} lainnya di Kalender</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Transaksi terakhir</CardTitle>
            <CardAction>
              <Link to="/transaksi" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                Lihat semua
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            {txList.length === 0 ? (
              <p className="text-sm text-muted-foreground">Belum ada transaksi di bulan ini.</p>
            ) : (
              <ul className="divide-y">
                {txList.slice(0, 5).map((t) => {
                  const it = itemList.find((i) => i.id === t.budget_item_id)
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 py-2.5 text-left"
                        onClick={() => openTransaction(t)}
                      >
                        <CategoryDot category={t.category} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{t.note || it?.name || CATEGORY_MAP[t.category].short}</span>
                          <span className="block text-xs text-muted-foreground">
                            {formatDate(t.date)} · {CATEGORY_MAP[t.category].short}
                          </span>
                        </span>
                        <span className={cn('text-sm font-medium tabular', t.category === 'income' && 'text-positive')}>
                          {t.category === 'income' ? '+' : '−'}
                          {formatIDR(t.amount)}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}

function SummaryRow({ sign, label, hint, plan, actual }: { sign: string; label: string; hint?: string; plan: number; actual: number }) {
  return (
    <tr className="border-b">
      <td className="py-2">
        <span className="mr-2 inline-block w-3 text-muted-foreground">{sign}</span>
        {label}
        {hint && <span className="block pl-5 text-xs text-muted-foreground">{hint}</span>}
      </td>
      <td className="py-2 text-right">{formatIDR(plan)}</td>
      <td className="py-2 text-right">{formatIDR(actual)}</td>
    </tr>
  )
}

export function prefillFromDue(d: DueEntry) {
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

function Onboarding() {
  const steps = [
    { to: '/budget', icon: WalletIcon, title: 'Tambah pendapatan', desc: 'Gaji, usaha sampingan, atau pemasukan rutin lain.' },
    { to: '/budget', icon: ReceiptIcon, title: 'Tambah tagihan & biaya rumah tangga', desc: 'Kontrakan, listrik, belanja mingguan, bensin.' },
    { to: '/hutang', icon: CreditCardIcon, title: 'Catat hutang', desc: 'Sisa pokok, cicilan per bulan, dan tanggal jatuh tempo.' },
    { to: '/tabungan', icon: PiggyBankIcon, title: 'Buat target tabungan', desc: 'Dana darurat, arisan, liburan, dsb.' },
  ]
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Selamat datang! Yuk mulai dalam 4 langkah</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-2 sm:grid-cols-2">
          {steps.map((s, i) => (
            <li key={s.title}>
              <Link to={s.to} className="flex gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/60">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">{i + 1}</span>
                <span>
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <s.icon className="size-4" /> {s.title}
                  </span>
                  <span className="text-xs text-muted-foreground">{s.desc}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <CircleIcon className="size-3" /> Setiap langkah boleh dilewati.
        </p>
      </CardContent>
    </Card>
  )
}
