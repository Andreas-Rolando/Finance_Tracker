import { useState } from 'react'
import { Link } from 'react-router'
import {
  AlertTriangleIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  CircleIcon,
  CreditCardIcon,
  EyeIcon,
  EyeOffIcon,
  InfoIcon,
  PiggyBankIcon,
  ReceiptIcon,
  SendIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  WalletIcon,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { MonthPicker } from '@/components/app/AppLayout'
import { CategoryTile } from '@/components/app/CategoryIcon'
import { DueTimeline, prefillFromDue } from '@/components/app/due'
import { PaceChart } from '@/components/app/PaceChart'
import {
  memberName,
  useBudgetItems,
  useDebtPaid,
  useDebts,
  useHousehold,
  useMonthlyActuals,
  useMonthSettings,
  useProfile,
  useSavingsGoals,
  useSavingsPaid,
  useSetCarryOver,
  useTransactions,
  useTransactionsRange,
} from '@/hooks/api'
import { CATEGORIES, CATEGORY_MAP } from '@/lib/categories'
import { addDaysISO, formatDate, formatMonth, MONTH_SHORT, prevMonth, todayISO, type YM } from '@/lib/dates'
import { carryOverFor, debtStatus, dueEntries, planTotals, savingsStatus, sumByCategory, summarize } from '@/lib/finance'
import {
  buildInsights,
  cumulativeExpenses,
  greeting,
  monthProgress,
  expectedSpendToDate,
  paceStatus,
  plannedCurve,
  sumCategoryBetween,
  type Insight,
  type Tone,
} from '@/lib/insights'
import type { Category, Household, Transaction } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useAuth } from '@/providers/auth'
import { useMonth } from '@/providers/month'
import { useMoney, usePrivacy } from '@/providers/privacy'
import { useTransactionDialog } from '@/providers/transaction-dialog'

const CHIP: Record<Tone, string> = {
  positive: 'bg-positive/10 text-positive',
  warning: 'bg-warning/12 text-warning',
  danger: 'bg-negative/10 text-negative',
  neutral: 'bg-muted text-muted-foreground',
}
/** Chip di atas kartu gelap (hero). */
const HERO_CHIP: Record<Tone, string> = {
  positive: 'bg-[#0f3a2c] text-[#7ee2b8]',
  warning: 'bg-[#3a2f12] text-[#f6c96a]',
  danger: 'bg-[#3d1717] text-[#ff9a9a]',
  neutral: 'bg-[var(--hero-track)] text-brand-mint-soft',
}
const INSIGHT_ICON: Record<Insight['icon'], typeof InfoIcon> = {
  alert: AlertTriangleIcon,
  down: TrendingDownIcon,
  up: TrendingUpIcon,
  calendar: CalendarClockIcon,
  check: CheckCircle2Icon,
  info: InfoIcon,
}

const shortMonth = (ym: YM) => `${MONTH_SHORT[ym.month - 1]} ${ym.year}`

export function DashboardPage() {
  const { ym } = useMonth()
  const { session } = useAuth()
  const { openTransaction } = useTransactionDialog()
  const { hidden, toggle } = usePrivacy()
  const money = useMoney()
  // Waktu ditetapkan sekali saat halaman dibuka (render tetap murni).
  const [now] = useState(() => new Date())
  const today = todayISO(now)

  const items = useBudgetItems()
  const txs = useTransactions(ym)
  const week = useTransactionsRange(addDaysISO(today, -13), today)
  const debts = useDebts()
  const debtPaid = useDebtPaid()
  const goals = useSavingsGoals()
  const savingsPaid = useSavingsPaid()
  const actuals = useMonthlyActuals()
  const settings = useMonthSettings()
  const setCarry = useSetCarryOver()
  const household = useHousehold().data
  const profile = useProfile(session?.user.id).data

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
  const outPlan = plan.savings + plan.spent + plan.debt
  const outActual = actual.savings + actual.spent + actual.debt
  const usedPct = outPlan > 0 ? Math.round((outActual / outPlan) * 100) : 0
  const progress = monthProgress(ym, today)
  const planCurve = plannedCurve(itemList, ym)
  const series = cumulativeExpenses(txList, ym, progress.day)
  const refDay = Math.max(progress.day, 1)
  const expectedToDate =
    progress.state === 'future' ? 0 : progress.state === 'past' ? outPlan : expectedSpendToDate(itemList, txList, ym, refDay)
  const actualToDate = progress.state === 'future' ? 0 : (series[refDay - 1] ?? 0)
  const expectedPct = outPlan > 0 ? Math.round((expectedToDate / outPlan) * 100) : 0
  const pace = paceStatus(actualToDate, expectedToDate, progress, outPlan > 0)
  const due = dueEntries(itemList, txList, ym, today)
  const weekTx = week.data ?? []
  const insights = buildInsights({
    progress,
    plan: planT,
    actual: actualT,
    planBalance: plan.balance,
    due,
    today,
    householdWeek: sumCategoryBetween(weekTx, 'household', addDaysISO(today, -6), today),
    householdPrevWeek: sumCategoryBetween(weekTx, 'household', addDaysISO(today, -13), addDaysISO(today, -7)),
    hasItems: itemList.length > 0,
  })
  const isNewUser = !loading && itemList.length === 0 && (debts.data ?? []).length === 0 && (goals.data ?? []).length === 0
  const firstName =
    profile?.full_name?.split(' ')[0] ||
    (session?.user.user_metadata?.full_name as string | undefined)?.split(' ')[0] ||
    session?.user.email?.split('@')[0] ||
    ''
  const todayLabel = now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  // Due timeline: belum bayar dulu (telat → terdekat), lalu yang sudah lunas.
  const timeline = [...due.filter((d) => d.status !== 'paid'), ...due.filter((d) => d.status === 'paid').reverse()].slice(0, 5)

  return (
    <div className="flex flex-col gap-5">
      {/* ---------- Sapaan & insight ---------- */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground first-letter:uppercase">{todayLabel}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-[28px]">
            {greeting(now.getHours())}
            {firstName ? `, ${firstName}` : ''}
          </h1>
          {insights.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2" aria-label="Insight">
              {insights.map((i) => {
                const Icon = INSIGHT_ICON[i.icon]
                return (
                  <li key={i.text} className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px]', CHIP[i.tone])}>
                    <Icon className="size-3.5" aria-hidden />
                    {hidden ? i.text.replace(/Rp [\d.]+/g, 'Rp ••••••') : i.text}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon-lg"
            onClick={toggle}
            aria-label={hidden ? 'Tampilkan nominal' : 'Sembunyikan nominal'}
            aria-pressed={hidden}
            title={hidden ? 'Tampilkan nominal' : 'Sembunyikan nominal'}
          >
            {hidden ? <EyeOffIcon /> : <EyeIcon />}
          </Button>
          <MonthPicker />
        </div>
      </header>

      {isNewUser && <Onboarding />}

      {/* ---------- Kartu utama + pendapatan/pengeluaran ---------- */}
      {loading ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-60 rounded-2xl lg:col-span-2" />
          <Skeleton className="h-60 rounded-2xl" />
        </div>
      ) : (
        <section aria-label="Ringkasan" className="grid gap-4 lg:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-5 rounded-2xl bg-[var(--hero)] p-6 text-[#e6f4ef] sm:p-7 lg:col-span-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-[var(--hero-muted)]">
                  Sisa saldo {progress.state === 'current' ? 'bulan ini' : formatMonth(ym)}
                </p>
                <p className={cn('mt-1.5 text-4xl font-semibold tracking-tight tabular sm:text-[44px]', actual.balance < 0 ? 'text-[#ff9a9a]' : 'text-white')}>
                  {money(actual.balance)}
                </p>
                <p className="mt-1.5 text-sm text-[var(--hero-muted)]">
                  Rencana akhir bulan <span className={cn('tabular', plan.balance < 0 ? 'text-[#ff9a9a]' : 'text-brand-mint-soft')}>{money(plan.balance)}</span>
                </p>
              </div>
              <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium', HERO_CHIP[pace.tone])}>
                {pace.tone === 'positive' ? <CheckCircle2Icon className="size-3.5" aria-hidden /> : <AlertTriangleIcon className="size-3.5" aria-hidden />}
                {pace.label}
              </span>
            </div>
            <div className="flex flex-col gap-3">
              <HeroBar
                label={
                  progress.state === 'current'
                    ? `Wajar terpakai s/d hari ke-${progress.day} · ${money(expectedToDate)}`
                    : progress.state === 'past'
                      ? 'Bulan sudah selesai'
                      : 'Bulan belum berjalan'
                }
                pct={progress.state === 'current' ? expectedPct : progress.elapsedPct}
                color="var(--hero-muted)"
              />
              <HeroBar
                label={`Budget pengeluaran terpakai · ${money(outActual)} dari ${money(outPlan)}`}
                pct={usedPct}
                color={usedPct > 100 ? '#ff7a7a' : 'var(--brand-emerald)'}
              />
            </div>
            <label className="flex flex-wrap items-center gap-2 border-t border-[var(--hero-track)] pt-4 text-[13px] text-[var(--hero-muted)]">
              <Switch
                size="sm"
                checked={carryOn}
                disabled={setCarry.isPending}
                onCheckedChange={(checked) => setCarry.mutate({ ym, carry_over: checked })}
              />
              Bawa sisa saldo {formatMonth(prevMonth(ym))}
              {carryOn && <span className="text-brand-mint-soft tabular">({money(carry)})</span>}
            </label>
          </div>

          <div className="grid min-w-0 grid-cols-2 gap-4 lg:grid-cols-1">
            <MiniStat category="income" label="Pendapatan" value={money(actual.income)} sub={plan.income > 0 ? `${Math.round((actual.income / plan.income) * 100)}% dari rencana` : 'Belum ada rencana'} />
            <MiniStat category="household" label="Pengeluaran" value={money(outActual)} sub={`Rencana ${money(outPlan)}`} trend />
          </div>
        </section>
      )}

      {/* ---------- Grafik laju ---------- */}
      {!loading && (
        <Card>
          <CardHeader>
            <CardTitle>Laju pengeluaran</CardTitle>
            <p className="text-sm text-muted-foreground">Kumulatif per hari vs rencana {formatMonth(ym)}, mengikuti tanggal jatuh tempo</p>
            <CardAction>
              <ul className="flex gap-4 text-xs text-muted-foreground">
                <li className="flex items-center gap-1.5">
                  <span aria-hidden className="h-[3px] w-4 rounded bg-brand-emerald" />
                  Realisasi
                </li>
                <li className="flex items-center gap-1.5">
                  <span aria-hidden className="w-4 border-t-2 border-dashed border-muted-foreground/70" />
                  Rencana
                </li>
              </ul>
            </CardAction>
          </CardHeader>
          <CardContent>
            {outPlan === 0 && outActual === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Belum ada rencana atau pengeluaran bulan ini.</p>
            ) : (
              <PaceChart
                series={series}
                plan={planCurve}
                todayDay={progress.state === 'current' ? progress.day : null}
                money={money}
                hidden={hidden}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* ---------- Per kategori ---------- */}
      {!loading && (
        <section aria-label="Per kategori" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {CATEGORIES.map((c) => (
            <CategoryCard key={c.key} category={c.key} plan={planT[c.key]} actual={actualT[c.key]} money={money} />
          ))}
        </section>
      )}

      {/* ---------- Jatuh tempo, widget, transaksi ---------- */}
      <section className="grid items-start gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Jatuh tempo</CardTitle>
              <CardAction>
                <Link to="/kalender" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                  Kalender
                </Link>
              </CardAction>
            </CardHeader>
            <CardContent>
              {timeline.length === 0 ? (
                <p className="text-sm text-muted-foreground">Belum ada tagihan dengan tanggal jatuh tempo. Tambahkan tanggal di Budget.</p>
              ) : (
                <DueTimeline entries={timeline} today={today} money={money} onPay={(e) => openTransaction(prefillFromDue(e))} />
              )}
            </CardContent>
          </Card>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <DebtWidget
              debts={debts.data ?? []}
              paid={debtPaid.data}
              money={money}
              loading={debts.isLoading || debtPaid.isLoading}
            />
            <SavingsWidget goals={goals.data ?? []} paid={savingsPaid.data} money={money} loading={goals.isLoading || savingsPaid.isLoading} />
          </div>
        </div>

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
                {txList.slice(0, 6).map((t) => (
                  <RecentRow
                    key={t.id}
                    tx={t}
                    title={itemList.find((i) => i.id === t.budget_item_id)?.name ?? t.note ?? CATEGORY_MAP[t.category].short}
                    household={household}
                    today={today}
                    money={money}
                    onClick={() => openTransaction(t)}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  )
}

// ====================================================================== bagian-bagian

function HeroBar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div>
      <div className="mb-1.5 flex justify-between gap-3 text-xs text-[var(--hero-muted)]">
        <span className="min-w-0 truncate">{label}</span>
        <span className="text-[#e6f4ef] tabular">{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-[var(--hero-track)]" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="h-2 rounded-full transition-[width] duration-700" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
      </div>
    </div>
  )
}

function MiniStat({ category, label, value, sub, trend }: { category: Category; label: string; value: string; sub: string; trend?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col rounded-2xl border bg-card p-5">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        {trend ? (
          <span aria-hidden className="grid size-7 place-items-center rounded-lg bg-[color-mix(in_oklab,var(--series-2)_16%,transparent)] text-[color-mix(in_oklab,var(--series-2)_72%,var(--foreground))]">
            <TrendingUpIcon className="size-3.5" />
          </span>
        ) : (
          <CategoryTile category={category} size="sm" />
        )}
        {label}
      </p>
      <p className="mt-2.5 truncate text-lg font-semibold tracking-tight tabular sm:text-2xl">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground tabular">{sub}</p>
    </div>
  )
}

function CategoryCard({ category, plan, actual, money }: { category: Category; plan: number; actual: number; money: (n: number) => string }) {
  const meta = CATEGORY_MAP[category]
  const pct = plan > 0 ? Math.round((actual / plan) * 100) : null
  const isSpend = category === 'bills' || category === 'household'
  const goodWhenFull = category === 'income' || category === 'savings'
  const tone: Tone =
    pct == null ? 'neutral' : isSpend ? (pct >= 100 ? 'danger' : pct >= 80 ? 'warning' : 'neutral') : goodWhenFull && pct >= 100 ? 'positive' : 'neutral'
  let sub: string
  if (plan <= 0) sub = actual > 0 ? 'Belum ada rencana' : '—'
  else if (goodWhenFull) sub = actual >= plan ? 'Target tercapai' : `Kurang ${money(plan - actual)}`
  else sub = actual <= plan ? `Sisa ${money(plan - actual)}` : `Lebih ${money(actual - plan)}`

  return (
    <div
      className={cn(
        'flex flex-col gap-2.5 rounded-2xl border bg-card p-4',
        tone === 'warning' && 'border-warning/35 bg-warning/5',
        tone === 'danger' && 'border-negative/35 bg-negative/5',
      )}
    >
      <div className="flex items-center justify-between">
        <CategoryTile category={category} />
        {pct != null && (
          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular', CHIP[tone])}>
            {(tone === 'warning' || tone === 'danger') && <AlertTriangleIcon className="size-3" aria-hidden />}
            {pct}%
          </span>
        )}
      </div>
      <p className="text-[13px] font-medium">{meta.short}</p>
      <p className="text-lg font-semibold tracking-tight tabular">{money(actual)}</p>
      <div className="h-1.5 rounded-full bg-muted">
        <div className="h-1.5 rounded-full transition-[width] duration-700" style={{ width: `${Math.min(pct ?? 0, 100)}%`, background: meta.colorVar }} />
      </div>
      <p className={cn('text-xs tabular', tone === 'danger' ? 'text-negative' : tone === 'warning' ? 'text-warning' : 'text-muted-foreground')}>{sub}</p>
    </div>
  )
}

function Avatar({ household, userId }: { household: Household | null | undefined; userId: string | null }) {
  const idx = household?.members.findIndex((m) => m.user_id === userId) ?? -1
  const m = idx >= 0 ? household!.members[idx] : null
  const name = memberName(household, userId) ?? '?'
  const cls = 'absolute -right-1 -bottom-1 size-5 rounded-full border-2 border-card'
  if (m?.profile?.avatar_url) {
    return <img src={m.profile.avatar_url} alt="" referrerPolicy="no-referrer" className={cn(cls, 'object-cover')} />
  }
  return (
    <span aria-hidden className={cn(cls, 'grid place-items-center text-[10px] font-semibold text-white')} style={{ background: idx === 1 ? '#a8335f' : '#2a78d6' }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}

function relativeDay(date: string, today: string): string {
  if (date === today) return 'Hari ini'
  if (date === addDaysISO(today, -1)) return 'Kemarin'
  return formatDate(date).replace(/ \d{4}$/, '')
}

function RecentRow({
  tx,
  title,
  household,
  today,
  money,
  onClick,
}: {
  tx: Transaction
  title: string
  household: Household | null | undefined
  today: string
  money: (n: number) => string
  onClick: () => void
}) {
  const who = memberName(household, tx.user_id)
  const income = tx.category === 'income'
  return (
    <li>
      <button type="button" onClick={onClick} className="flex w-full items-center gap-3 py-3 text-left transition-colors hover:bg-muted/40">
        <span className="relative">
          <CategoryTile category={tx.category} size="lg" />
          <Avatar household={household} userId={tx.user_id} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 truncate text-sm font-medium">
            <span className="truncate">{title}</span>
            {tx.source === 'telegram' && <SendIcon className="size-3 shrink-0 text-[var(--series-1)]" aria-label="via Telegram" />}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {CATEGORY_MAP[tx.category].short} · {relativeDay(tx.date, today)}
            {who ? ` · ${who}` : ''}
          </span>
        </span>
        <span className={cn('text-sm font-semibold tabular', income && 'text-positive')}>
          {income ? '+' : '−'}
          {money(tx.amount).replace(/^-/, '')}
        </span>
      </button>
    </li>
  )
}

function WidgetShell({ title, to, children }: { title: string; to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="flex flex-col gap-2 rounded-2xl border bg-card p-5 transition-colors hover:border-foreground/20">
      <p className="text-sm text-muted-foreground">{title}</p>
      {children}
    </Link>
  )
}

function DebtWidget({
  debts,
  paid,
  money,
  loading,
}: {
  debts: import('@/lib/types').Debt[]
  paid: Map<string, { paid: number }> | undefined
  money: (n: number) => string
  loading: boolean
}) {
  if (loading) return <Skeleton className="h-32 rounded-2xl" />
  const active = debts.filter((d) => d.status === 'active')
  if (!active.length) {
    return (
      <WidgetShell title="Sisa hutang" to="/hutang">
        <p className="flex items-center gap-1.5 text-sm text-positive">
          <CheckCircle2Icon className="size-4" aria-hidden /> Tidak ada hutang aktif
        </p>
      </WidgetShell>
    )
  }
  const from = { year: Number(todayISO().slice(0, 4)), month: Number(todayISO().slice(5, 7)) }
  const st = active.map((d) => ({ d, s: debtStatus(d, paid?.get(d.id)?.paid ?? 0, from) }))
  const remaining = st.reduce((s, x) => s + x.s.remaining, 0)
  const principal = st.reduce((s, x) => s + x.d.principal, 0)
  const pct = principal > 0 ? Math.round(((principal - remaining) / principal) * 100) : 100
  const payoffs = st.map((x) => x.s.payoff).filter(Boolean) as YM[]
  const last = payoffs.sort((a, b) => b.year * 12 + b.month - (a.year * 12 + a.month))[0]
  return (
    <WidgetShell title="Sisa hutang" to="/hutang">
      <p className="text-xl font-semibold tracking-tight tabular">{money(remaining)}</p>
      <div className="h-1.5 rounded-full bg-muted">
        <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: 'var(--series-5)' }} />
      </div>
      <p className="text-xs text-muted-foreground">
        {pct}% terbayar{last ? ` · bebas hutang ±${shortMonth(last)}` : ''}
      </p>
    </WidgetShell>
  )
}

function SavingsWidget({
  goals,
  paid,
  money,
  loading,
}: {
  goals: import('@/lib/types').SavingsGoal[]
  paid: Map<string, number> | undefined
  money: (n: number) => string
  loading: boolean
}) {
  if (loading) return <Skeleton className="h-32 rounded-2xl" />
  if (!goals.length) {
    return (
      <WidgetShell title="Tabungan" to="/tabungan">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <PiggyBankIcon className="size-4" aria-hidden /> Buat target tabungan pertama
        </p>
      </WidgetShell>
    )
  }
  const from = { year: Number(todayISO().slice(0, 4)), month: Number(todayISO().slice(5, 7)) }
  const st = goals.map((g) => savingsStatus(g, paid?.get(g.id) ?? 0, from))
  const saved = st.reduce((s, x) => s + x.saved, 0)
  const target = goals.reduce((s, g) => s + g.target_amount, 0)
  const pct = target > 0 ? Math.min(Math.round((saved / target) * 100), 100) : 0
  const single = goals.length === 1
  return (
    <WidgetShell title={single ? goals[0].name : `Tabungan (${goals.length} target)`} to="/tabungan">
      <p className="text-xl font-semibold tracking-tight tabular">{money(saved)}</p>
      <div className="h-1.5 rounded-full bg-muted">
        <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: 'var(--series-2)' }} />
      </div>
      <p className="text-xs text-muted-foreground">
        {pct}% dari {money(target)}
        {single && st[0].eta ? ` · tercapai ±${shortMonth(st[0].eta)}` : ''}
      </p>
    </WidgetShell>
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
    <Card>
      <CardHeader>
        <CardTitle>Yuk mulai dalam 4 langkah</CardTitle>
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
