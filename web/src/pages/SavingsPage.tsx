import { useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2Icon, PencilIcon, PiggyBankIcon, PlusIcon, Trash2Icon } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, Meter, PageHeader, Stat } from '@/components/app/bits'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { Field, MoneyInput } from '@/components/app/fields'
import {
  useBudgetItems,
  useDeleteSavingsGoal,
  useSaveSavingsGoal,
  useSavingsGoals,
  useSavingsPaid,
} from '@/hooks/api'
import { currentYM, formatDate, formatMonth, ymOf } from '@/lib/dates'
import { savingsStatus } from '@/lib/finance'
import { formatIDR } from '@/lib/format'
import type { SavingsGoal } from '@/lib/types'
import { useTransactionDialog } from '@/providers/transaction-dialog'

export function SavingsPage() {
  const goals = useSavingsGoals()
  const paid = useSavingsPaid()
  const items = useBudgetItems().data ?? []
  const { openTransaction } = useTransactionDialog()
  const del = useDeleteSavingsGoal()
  const [dialog, setDialog] = useState<{ open: boolean; goal?: SavingsGoal }>({ open: false })
  const [toDelete, setToDelete] = useState<SavingsGoal | null>(null)
  const cur = currentYM()

  const list = goals.data ?? []
  const statusOf = (g: SavingsGoal) => savingsStatus(g, paid.data?.get(g.id) ?? 0, cur)
  const totalTarget = list.reduce((s, g) => s + g.target_amount, 0)
  const totalSaved = list.reduce((s, g) => s + statusOf(g).saved, 0)

  return (
    <>
      <PageHeader
        title="Tabungan"
        description="Target tabungan & progresnya. Setoran dicatat sebagai transaksi kategori Tabungan."
        actions={
          <Button onClick={() => setDialog({ open: true })}>
            <PlusIcon /> Tambah target
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3">
        <Stat label="Total target" value={formatIDR(totalTarget)} sub={`${list.length} target`} />
        <Stat
          label="Total terkumpul"
          value={formatIDR(totalSaved)}
          sub={totalTarget > 0 ? `${Math.round((totalSaved / totalTarget) * 100)}% dari target` : undefined}
        />
      </div>

      {goals.isLoading || paid.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={<PiggyBankIcon />}
          title="Belum ada target tabungan"
          description="Dana darurat, arisan, DP rumah, liburan — buat target dan pantau progresnya."
          action={
            <Button onClick={() => setDialog({ open: true })}>
              <PlusIcon /> Tambah target
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {list.map((g) => {
            const s = statusOf(g)
            return (
              <Card key={g.id}>
                <CardHeader>
                  <div className="min-w-0">
                    <CardTitle className="truncate">{g.name}</CardTitle>
                    <CardDescription className="tabular">
                      Target {formatIDR(g.target_amount)}
                      {g.target_date ? ` · ${formatDate(g.target_date)}` : ''}
                    </CardDescription>
                  </div>
                  <CardAction className="flex">
                    <Button variant="ghost" size="icon-sm" aria-label={`Edit ${g.name}`} onClick={() => setDialog({ open: true, goal: g })}>
                      <PencilIcon />
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Hapus ${g.name}`} onClick={() => setToDelete(g)}>
                      <Trash2Icon />
                    </Button>
                  </CardAction>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <div>
                    <div className="mb-1.5 flex items-baseline justify-between text-sm">
                      <span className="text-muted-foreground">Terkumpul</span>
                      <span className="text-lg font-semibold tabular">{formatIDR(s.saved)}</span>
                    </div>
                    <Meter value={s.saved} max={g.target_amount} color="var(--series-2)" over="positive" label={`${Math.round(s.progress)}% tercapai`} />
                    <div className="mt-1.5 flex justify-between text-xs text-muted-foreground tabular">
                      <span>{Math.round(s.progress)}%</span>
                      <span>Kurang {formatIDR(s.remaining)}</span>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {s.remaining === 0 ? (
                      <Badge variant="outline" className="gap-1 text-positive">
                        <CheckCircle2Icon /> Target tercapai
                      </Badge>
                    ) : s.eta ? (
                      <span>
                        Setoran {formatIDR(g.monthly_plan)}/bln → tercapai {formatMonth(s.eta)}
                        {g.target_date && ymOf(g.target_date) && compareLate(s.eta, ymOf(g.target_date)) && (
                          <span className="text-negative"> (lewat dari target tanggal)</span>
                        )}
                      </span>
                    ) : (
                      <span>Isi setoran bulanan untuk estimasi.</span>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    onClick={() =>
                      openTransaction({
                        category: 'savings',
                        savings_goal_id: g.id,
                        amount: g.monthly_plan || undefined,
                        budget_item_id: items.find((i) => i.savings_goal_id === g.id && !i.effective_to)?.id ?? null,
                      })
                    }
                  >
                    Setor
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={dialog.open} onOpenChange={(open) => !open && setDialog({ open: false })}>
        <DialogContent className="sm:max-w-md">
          {dialog.open && <GoalForm key={dialog.goal?.id ?? 'new'} goal={dialog.goal} onDone={() => setDialog({ open: false })} />}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={toDelete != null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Hapus "${toDelete?.name}"?`}
        description="Target dihapus. Transaksi setoran tetap tersimpan tapi tidak lagi terhubung."
        onConfirm={async () => {
          await del.mutateAsync(toDelete!.id)
          toast.success('Target dihapus')
        }}
      />
    </>
  )
}

function compareLate(a: { year: number; month: number }, b: { year: number; month: number }) {
  return a.year * 12 + a.month > b.year * 12 + b.month
}

function GoalForm({ goal, onDone }: { goal?: SavingsGoal; onDone: () => void }) {
  const save = useSaveSavingsGoal()
  const [name, setName] = useState(goal?.name ?? '')
  const [target, setTarget] = useState<number | null>(goal?.target_amount ?? null)
  const [initial, setInitial] = useState<number | null>(goal?.initial_amount ?? null)
  const [monthly, setMonthly] = useState<number | null>(goal?.monthly_plan ?? null)
  const [targetDate, setTargetDate] = useState(goal?.target_date ?? '')
  const [dueDay, setDueDay] = useState('')
  const [addToBudget, setAddToBudget] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Nama wajib diisi')
    if (!target || target <= 0) return setError('Target harus lebih dari 0')
    const day = dueDay ? Number(dueDay) : null
    if (day != null && (day < 1 || day > 31 || !Number.isInteger(day))) return setError('Tanggal 1–31')
    setError(null)
    try {
      await save.mutateAsync({
        id: goal?.id,
        input: {
          name: name.trim(),
          target_amount: target,
          initial_amount: initial ?? 0,
          monthly_plan: monthly ?? 0,
          target_date: targetDate || null,
        },
        addToBudget,
        dueDay: day,
      })
      toast.success(goal ? 'Target diperbarui' : 'Target ditambahkan')
      onDone()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{goal ? 'Edit target tabungan' : 'Tambah target tabungan'}</DialogTitle>
        <DialogDescription>Progres dihitung dari jumlah awal + setoran yang dicatat.</DialogDescription>
      </DialogHeader>
      <Field label="Nama target" htmlFor="g-name">
        <Input id="g-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. Dana darurat" autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Target" htmlFor="g-target">
          <MoneyInput id="g-target" value={target} onChange={setTarget} placeholder="0" />
        </Field>
        <Field label="Jumlah awal" htmlFor="g-initial" hint="Yang sudah terkumpul">
          <MoneyInput id="g-initial" value={initial} onChange={setInitial} placeholder="0" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Setoran / bulan" htmlFor="g-monthly">
          <MoneyInput id="g-monthly" value={monthly} onChange={setMonthly} placeholder="0" />
        </Field>
        <Field label="Tanggal target" htmlFor="g-date" hint="Opsional">
          <Input id="g-date" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
        </Field>
      </div>
      {!goal && (
        <>
          <Label className="flex items-start gap-2 font-normal">
            <Checkbox checked={addToBudget} onCheckedChange={(v) => setAddToBudget(Boolean(v))} className="mt-0.5" />
            <span>
              Tambahkan setoran ke budget bulanan
              <span className="block text-xs text-muted-foreground">Masuk ke rencana kategori Tabungan & Investasi.</span>
            </span>
          </Label>
          {addToBudget && (
            <Field label="Tanggal setor rutin" htmlFor="g-day" hint="Opsional, untuk kalender">
              <Input id="g-day" type="number" min={1} max={31} value={dueDay} onChange={(e) => setDueDay(e.target.value)} placeholder="—" className="w-24" />
            </Field>
          )}
        </>
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
