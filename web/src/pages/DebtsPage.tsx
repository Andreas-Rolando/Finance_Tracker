import { useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangleIcon,
  ArchiveIcon,
  ArchiveRestoreIcon,
  CheckCircle2Icon,
  CreditCardIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, Meter, PageHeader, Stat } from '@/components/app/bits'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { Field, MoneyInput } from '@/components/app/fields'
import {
  useBudgetItems,
  useDebtPaid,
  useDebts,
  useDeleteDebt,
  useSaveDebt,
  useSetDebtStatus,
  type DebtInput,
} from '@/hooks/api'
import { currentYM, formatDate, formatMonth } from '@/lib/dates'
import { debtStatus, planTotals, simulatePayoff } from '@/lib/finance'
import { formatIDR, percent } from '@/lib/format'
import type { Debt } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useTransactionDialog } from '@/providers/transaction-dialog'

export function DebtsPage() {
  const debts = useDebts()
  const paid = useDebtPaid()
  const items = useBudgetItems()
  const { openTransaction } = useTransactionDialog()
  const [dialog, setDialog] = useState<{ open: boolean; debt?: Debt }>({ open: false })
  const [toDelete, setToDelete] = useState<Debt | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const setStatus = useSetDebtStatus()
  const del = useDeleteDebt()

  const cur = currentYM()
  const all = debts.data ?? []
  const active = all.filter((d) => d.status === 'active')
  const archived = all.filter((d) => d.status === 'archived')
  const statusOf = (d: Debt) => debtStatus(d, paid.data?.get(d.id)?.paid ?? 0, cur)

  const totalRemaining = active.reduce((s, d) => s + statusOf(d).remaining, 0)
  const totalInstallment = active.filter((d) => !statusOf(d).isPaidOff).reduce((s, d) => s + d.monthly_installment, 0)
  const income = planTotals(items.data ?? [], cur).income
  const ratio = income > 0 ? percent(totalInstallment, income) : null

  return (
    <>
      <PageHeader
        title="Hutang"
        description="Sisa hutang berkurang otomatis setiap kamu mencatat pembayaran."
        actions={
          <Button onClick={() => setDialog({ open: true })}>
            <PlusIcon /> Tambah hutang
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Total sisa hutang" value={formatIDR(totalRemaining)} sub={`${active.length} hutang aktif`} />
        <Stat label="Total cicilan / bulan" value={formatIDR(totalInstallment)} />
        <Stat
          label="Rasio cicilan vs pendapatan"
          value={ratio == null ? '—' : `${Math.round(ratio)}%`}
          tone={ratio != null && ratio > 30 ? 'negative' : undefined}
          sub={ratio == null ? 'Isi pendapatan di Budget' : ratio > 30 ? 'Di atas batas sehat 30%' : 'Dalam batas sehat (≤ 30%)'}
        />
      </div>

      {ratio != null && ratio > 30 && (
        <Alert variant="destructive" className="mb-6">
          <AlertTriangleIcon />
          <AlertTitle>Cicilan memakan {Math.round(ratio)}% pendapatan</AlertTitle>
          <AlertDescription>
            Batas yang umum disarankan maksimal 30%. Coba simulasi di bawah untuk melihat strategi pelunasan tercepat.
          </AlertDescription>
        </Alert>
      )}

      {debts.isLoading || paid.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : active.length === 0 ? (
        <EmptyState
          icon={<CreditCardIcon />}
          title="Belum ada hutang aktif"
          description="Catat pinjaman, kartu kredit, atau paylater beserta cicilan dan tanggal jatuh temponya."
          action={
            <Button onClick={() => setDialog({ open: true })}>
              <PlusIcon /> Tambah hutang
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {active.map((d) => (
            <DebtCard
              key={d.id}
              debt={d}
              status={statusOf(d)}
              lastPaid={paid.data?.get(d.id)?.last_paid ?? null}
              payments={paid.data?.get(d.id)?.payments ?? 0}
              onPay={() =>
                openTransaction({
                  category: 'debt',
                  debt_id: d.id,
                  amount: Math.min(d.monthly_installment || statusOf(d).remaining, statusOf(d).remaining) || undefined,
                  budget_item_id: (items.data ?? []).find((i) => i.debt_id === d.id && !i.effective_to)?.id ?? null,
                })
              }
              onEdit={() => setDialog({ open: true, debt: d })}
              onArchive={() =>
                setStatus.mutate(
                  { id: d.id, status: 'archived' },
                  { onSuccess: () => toast.success(`${d.name} diarsipkan`) },
                )
              }
              onDelete={() => setToDelete(d)}
            />
          ))}
        </div>
      )}

      {active.length > 0 && <PayoffSimulator debts={active} statusOf={statusOf} />}

      {archived.length > 0 && (
        <div className="mt-8">
          <Button variant="ghost" size="sm" onClick={() => setShowArchived((v) => !v)}>
            <ArchiveIcon /> {showArchived ? 'Sembunyikan' : 'Tampilkan'} arsip ({archived.length})
          </Button>
          {showArchived && (
            <ul className="mt-2 divide-y rounded-xl border">
              {archived.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <span className="flex-1">{d.name}</span>
                  <span className="text-muted-foreground tabular">{formatIDR(d.principal)}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setStatus.mutate({ id: d.id, status: 'active' })}
                  >
                    <ArchiveRestoreIcon /> Aktifkan
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Hapus ${d.name}`} onClick={() => setToDelete(d)}>
                    <Trash2Icon />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Dialog open={dialog.open} onOpenChange={(open) => !open && setDialog({ open: false })}>
        <DialogContent className="sm:max-w-md">
          {dialog.open && <DebtForm key={dialog.debt?.id ?? 'new'} debt={dialog.debt} onDone={() => setDialog({ open: false })} />}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={toDelete != null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Hapus "${toDelete?.name}"?`}
        description="Data hutang dihapus permanen. Transaksi pembayaran tetap tersimpan tapi tidak lagi terhubung. Kalau hutang sudah lunas, lebih baik diarsipkan."
        onConfirm={async () => {
          await del.mutateAsync(toDelete!.id)
          toast.success('Hutang dihapus')
        }}
      />
    </>
  )
}

function DebtCard({
  debt,
  status,
  lastPaid,
  payments,
  onPay,
  onEdit,
  onArchive,
  onDelete,
}: {
  debt: Debt
  status: ReturnType<typeof debtStatus>
  lastPaid: string | null
  payments: number
  onPay: () => void
  onEdit: () => void
  onArchive: () => void
  onDelete: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="truncate">{debt.name}</CardTitle>
          <CardDescription className="tabular">
            Cicilan {formatIDR(debt.monthly_installment)}
            {debt.due_day ? ` · tgl ${debt.due_day}` : ''}
            {debt.interest_rate_monthly ? ` · bunga ${debt.interest_rate_monthly.toLocaleString('id-ID')}%/bln` : ''}
          </CardDescription>
        </div>
        <CardAction>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label={`Aksi untuk ${debt.name}`} />}
          >
            <MoreHorizontalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={onEdit}>
              <PencilIcon /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onArchive}>
              <ArchiveIcon /> Arsipkan
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2Icon /> Hapus
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div>
          <div className="mb-1.5 flex items-baseline justify-between text-sm">
            <span className="text-muted-foreground">Sisa</span>
            <span className="text-lg font-semibold tabular">{formatIDR(status.remaining)}</span>
          </div>
          <Meter value={status.paid} max={debt.principal} color="var(--series-5)" over="positive" label={`Terbayar ${Math.round(status.progress)}%`} />
          <div className="mt-1.5 flex justify-between text-xs text-muted-foreground tabular">
            <span>Terbayar {formatIDR(status.paid)} ({Math.round(status.progress)}%)</span>
            <span>dari {formatIDR(debt.principal)}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          {status.isPaidOff ? (
            <Badge variant="outline" className="gap-1 text-positive">
              <CheckCircle2Icon /> Lunas
            </Badge>
          ) : (
            <span>
              {status.payoff
                ? `Estimasi lunas ${formatMonth(status.payoff)} (${status.monthsLeft} bln lagi)`
                : 'Isi cicilan untuk estimasi lunas'}
            </span>
          )}
          <span>{payments > 0 && lastPaid ? `Terakhir bayar ${formatDate(lastPaid)}` : 'Belum ada pembayaran'}</span>
        </div>
        {status.isPaidOff ? (
          <Button variant="outline" onClick={onArchive}>
            <ArchiveIcon /> Arsipkan
          </Button>
        ) : (
          <Button variant="outline" onClick={onPay}>
            Catat pembayaran
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function DebtForm({ debt, onDone }: { debt?: Debt; onDone: () => void }) {
  const save = useSaveDebt()
  const [name, setName] = useState(debt?.name ?? '')
  const [principal, setPrincipal] = useState<number | null>(debt?.principal ?? null)
  const [installment, setInstallment] = useState<number | null>(debt?.monthly_installment ?? null)
  const [rate, setRate] = useState(debt?.interest_rate_monthly != null ? String(debt.interest_rate_monthly) : '')
  const [dueDay, setDueDay] = useState(debt?.due_day ? String(debt.due_day) : '')
  const [startDate, setStartDate] = useState(debt?.start_date ?? '')
  const [tenor, setTenor] = useState(debt?.tenor_months ? String(debt.tenor_months) : '')
  const [addToBudget, setAddToBudget] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const day = dueDay ? Number(dueDay) : null
    const r = rate ? Number(rate.replace(',', '.')) : null
    if (!name.trim()) return setError('Nama wajib diisi')
    if (principal == null) return setError('Sisa hutang wajib diisi')
    if (day != null && (day < 1 || day > 31 || !Number.isInteger(day))) return setError('Tanggal jatuh tempo 1–31')
    if (r != null && (Number.isNaN(r) || r < 0)) return setError('Bunga tidak valid')
    const input: DebtInput = {
      name: name.trim(),
      principal,
      monthly_installment: installment ?? 0,
      interest_rate_monthly: r,
      due_day: day,
      start_date: startDate || null,
      tenor_months: tenor ? Number(tenor) : null,
    }
    setError(null)
    try {
      await save.mutateAsync({ id: debt?.id, input, addToBudget })
      toast.success(debt ? 'Hutang diperbarui' : 'Hutang ditambahkan')
      onDone()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{debt ? 'Edit hutang' : 'Tambah hutang'}</DialogTitle>
        <DialogDescription>
          {debt ? 'Perubahan cicilan juga memperbarui item budget yang terhubung.' : 'Pinjaman, kartu kredit, paylater, dsb.'}
        </DialogDescription>
      </DialogHeader>
      <Field label="Nama / pemberi pinjaman" htmlFor="d-name">
        <Input id="d-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. Kartu kredit" autoFocus />
      </Field>
      <Field label="Sisa hutang saat ini" htmlFor="d-principal" hint="Total yang masih harus dibayar saat mulai dicatat.">
        <MoneyInput id="d-principal" value={principal} onChange={setPrincipal} placeholder="0" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Cicilan / bulan" htmlFor="d-inst">
          <MoneyInput id="d-inst" value={installment} onChange={setInstallment} placeholder="0" />
        </Field>
        <Field label="Bunga % / bulan" htmlFor="d-rate" hint="Opsional">
          <Input id="d-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="mis. 2,5" />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Tgl jatuh tempo" htmlFor="d-day">
          <Input id="d-day" type="number" min={1} max={31} value={dueDay} onChange={(e) => setDueDay(e.target.value)} placeholder="—" />
        </Field>
        <Field label="Tenor (bln)" htmlFor="d-tenor">
          <Input id="d-tenor" type="number" min={1} value={tenor} onChange={(e) => setTenor(e.target.value)} placeholder="—" />
        </Field>
        <Field label="Mulai" htmlFor="d-start">
          <Input id="d-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
      </div>
      {!debt && (
        <Label className="flex items-start gap-2 font-normal">
          <Checkbox checked={addToBudget} onCheckedChange={(v) => setAddToBudget(Boolean(v))} className="mt-0.5" />
          <span>
            Tambahkan cicilan ke budget bulanan
            <span className="block text-xs text-muted-foreground">Muncul di rencana & kalender jatuh tempo.</span>
          </span>
        </Label>
      )}
      {error && <p className="text-sm text-negative">{error}</p>}
      <DialogFooter>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Menyimpan…' : 'Simpan'}
        </Button>
      </DialogFooter>
    </form>
  )
}

function PayoffSimulator({ debts, statusOf }: { debts: Debt[]; statusOf: (d: Debt) => ReturnType<typeof debtStatus> }) {
  const [extra, setExtra] = useState<number | null>(0)
  const cur = currentYM()
  const input = debts
    .map((d) => ({
      id: d.id,
      name: d.name,
      balance: statusOf(d).remaining,
      installment: d.monthly_installment,
      rate: d.interest_rate_monthly ?? 0,
    }))
    .filter((d) => d.balance > 0)
  if (input.length === 0) return null
  const results = (['avalanche', 'snowball'] as const).map((s) => simulatePayoff(input, extra ?? 0, s, cur))
  const [av, sb] = results
  const same = av.months === sb.months && av.totalInterest === sb.totalInterest
  const best = same
    ? null
    : (av.months ?? Infinity) < (sb.months ?? Infinity) ||
        ((av.months ?? Infinity) === (sb.months ?? Infinity) && av.totalInterest <= sb.totalInterest)
      ? av
      : sb
  const hasRates = input.some((d) => d.rate > 0)

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Simulasi pelunasan</CardTitle>
        <CardDescription>
          Uang tambahan + cicilan dari hutang yang sudah lunas dialihkan ke hutang prioritas berikutnya.
          {!hasRates && ' Isi bunga per bulan di tiap hutang agar perbandingan lebih akurat.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Field label="Pembayaran tambahan per bulan" htmlFor="sim-extra" className="sm:max-w-xs">
          <MoneyInput id="sim-extra" value={extra} onChange={setExtra} placeholder="0" />
        </Field>
        {same && (
          <p className="text-xs text-muted-foreground">
            Untuk hutang kamu saat ini, kedua strategi menghasilkan urutan & waktu yang sama.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {results.map((r) => (
            <div key={r.strategy} className={cn('rounded-xl border p-4', r === best && 'border-foreground')}>
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{r.strategy === 'avalanche' ? 'Avalanche' : 'Snowball'}</p>
                {r === best && <Badge>{av.months === sb.months ? 'Paling hemat' : 'Paling cepat'}</Badge>}
              </div>
              <p className="text-xs text-muted-foreground">
                {r.strategy === 'avalanche' ? 'Bunga tertinggi dulu — paling hemat bunga.' : 'Sisa terkecil dulu — cepat terasa progresnya.'}
              </p>
              {r.months == null ? (
                <p className="mt-3 text-sm text-negative">Tidak akan lunas dalam 50 tahun dengan cicilan saat ini.</p>
              ) : (
                <>
                  <p className="mt-3 text-lg font-semibold">Bebas hutang {r.debtFree ? formatMonth(r.debtFree) : '—'}</p>
                  <p className="text-xs text-muted-foreground tabular">
                    {r.months} bulan · total bunga {formatIDR(r.totalInterest)}
                  </p>
                  <ol className="mt-3 grid gap-1 text-xs">
                    {r.order.map((o, i) => (
                      <li key={o.id} className="flex justify-between gap-2">
                        <span className="truncate">
                          {i + 1}. {o.name}
                        </span>
                        <span className="shrink-0 text-muted-foreground tabular">{o.payoff ? formatMonth(o.payoff) : '—'}</span>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
