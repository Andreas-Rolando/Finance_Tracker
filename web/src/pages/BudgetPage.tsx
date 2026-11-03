import { useState } from 'react'
import { toast } from 'sonner'
import { CalendarIcon, LinkIcon, PencilIcon, PlusIcon, Trash2Icon, WalletIcon } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { CategoryDot, EmptyState, PageHeader, Stat } from '@/components/app/bits'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { Field, MoneyInput, NativeSelect } from '@/components/app/fields'
import {
  useBudgetItems,
  useDebts,
  useDeleteBudgetItem,
  useSaveBudgetItem,
  useSavingsGoals,
  type BudgetItemInput,
} from '@/hooks/api'
import { CATEGORIES } from '@/lib/categories'
import { currentYM, formatMonth, inputToYM, MONTH_NAMES, monthStart, ymOf, ymToInput } from '@/lib/dates'
import { currentItems, monthlyEquivalent, planTotals, summarize } from '@/lib/finance'
import { formatIDR } from '@/lib/format'
import type { BudgetItem, Category, Frequency } from '@/lib/types'

type DialogState = { open: false } | { open: true; item?: BudgetItem; category?: Category }

export function BudgetPage() {
  const items = useBudgetItems()
  const [dialog, setDialog] = useState<DialogState>({ open: false })
  const cur = currentYM()
  const list = currentItems(items.data ?? [], cur)
  const totals = planTotals(items.data ?? [], cur)
  const s = summarize(totals)
  const out = s.savings + s.spent + s.debt

  return (
    <>
      <PageHeader
        title="Budget"
        description="Rencana pemasukan & pengeluaran rutin. Perubahan berlaku mulai bulan ini."
        actions={
          <Button onClick={() => setDialog({ open: true })}>
            <PlusIcon /> Tambah item
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label={`Pendapatan · ${formatMonth(cur)}`} value={formatIDR(s.income)} />
        <Stat label="Total pengeluaran" value={formatIDR(out)} sub="Tabungan + tagihan + rumah tangga + hutang" />
        <Stat
          label="Selisih pendapatan & pengeluaran"
          value={formatIDR(s.balance)}
          tone={s.balance < 0 ? 'negative' : 'positive'}
          sub={s.balance < 0 ? 'Defisit' : 'Surplus'}
        />
      </div>

      {items.isLoading ? (
        <div className="grid gap-4">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={<WalletIcon />}
          title="Belum ada budget"
          description="Tulis semua pemasukan dan pengeluaran rutin setiap bulan sedetail mungkin — mulai dari gaji, kontrakan, listrik, sampai belanja mingguan."
          action={
            <Button onClick={() => setDialog({ open: true, category: 'income' })}>
              <PlusIcon /> Tambah pendapatan
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {CATEGORIES.map((c) => {
            const rows = list.filter((i) => i.category === c.key)
            return (
              <Card key={c.key}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CategoryDot category={c.key} /> {c.label}
                  </CardTitle>
                  <CardAction className="text-sm font-semibold tabular">{formatIDR(totals[c.key])}</CardAction>
                </CardHeader>
                <CardContent className="grid gap-1">
                  {rows.length === 0 && <p className="text-sm text-muted-foreground">Belum ada item.</p>}
                  <ul className="divide-y">
                    {rows.map((i) => (
                      <li key={i.id} className="flex items-center gap-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                            {i.name}
                            {(i.debt_id || i.savings_goal_id) && (
                              <LinkIcon className="size-3 text-muted-foreground" aria-label="Terhubung" />
                            )}
                          </p>
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            {i.frequency === 'yearly' && (
                              <Badge variant="secondary">Tahunan · {MONTH_NAMES[(i.due_month ?? 1) - 1]}</Badge>
                            )}
                            {i.due_day && (
                              <Badge variant="outline" className="gap-1">
                                <CalendarIcon /> Tgl {i.due_day}
                              </Badge>
                            )}
                            {i.effective_from > monthStart(cur) && (
                              <Badge variant="outline">Mulai {formatMonth(ymOf(i.effective_from))}</Badge>
                            )}
                          </div>
                          {i.frequency === 'yearly' && (
                            <p className="mt-0.5 text-xs text-muted-foreground tabular">
                              Sisihkan {formatIDR(monthlyEquivalent(i))}/bulan
                            </p>
                          )}
                        </div>
                        <span className="text-sm tabular">{formatIDR(i.amount)}</span>
                        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${i.name}`} onClick={() => setDialog({ open: true, item: i })}>
                          <PencilIcon />
                        </Button>
                      </li>
                    ))}
                  </ul>
                  <Button variant="ghost" size="sm" className="justify-start text-muted-foreground" onClick={() => setDialog({ open: true, category: c.key })}>
                    <PlusIcon /> Tambah {c.short.toLowerCase()}
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={dialog.open} onOpenChange={(open) => !open && setDialog({ open: false })}>
        <DialogContent className="sm:max-w-md">
          {dialog.open && (
            <BudgetItemForm
              key={dialog.item?.id ?? `new-${dialog.category}`}
              item={dialog.item}
              defaultCategory={dialog.category}
              onDone={() => setDialog({ open: false })}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function BudgetItemForm({
  item,
  defaultCategory,
  onDone,
}: {
  item?: BudgetItem
  defaultCategory?: Category
  onDone: () => void
}) {
  const debts = useDebts().data ?? []
  const goals = useSavingsGoals().data ?? []
  const save = useSaveBudgetItem()
  const del = useDeleteBudgetItem()
  const cur = currentYM()

  const [name, setName] = useState(item?.name ?? '')
  const [category, setCategory] = useState<Category>(item?.category ?? defaultCategory ?? 'bills')
  const [amount, setAmount] = useState<number | null>(item?.amount ?? null)
  const [frequency, setFrequency] = useState<Frequency>(item?.frequency ?? 'monthly')
  const [dueDay, setDueDay] = useState(item?.due_day ? String(item.due_day) : '')
  const [dueMonth, setDueMonth] = useState(String(item?.due_month ?? cur.month))
  const [from, setFrom] = useState(ymToInput(cur))
  const [debtId, setDebtId] = useState(item?.debt_id ?? '')
  const [goalId, setGoalId] = useState(item?.savings_goal_id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)

  const hasHistory = item ? item.effective_from < monthStart(cur) : false

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const day = dueDay ? Number(dueDay) : null
    if (!name.trim()) return setError('Nama item wajib diisi')
    if (amount == null) return setError('Jumlah wajib diisi')
    if (day != null && (!Number.isInteger(day) || day < 1 || day > 31)) return setError('Tanggal jatuh tempo 1–31')
    const fromYM = inputToYM(from)
    const input: BudgetItemInput = {
      name: name.trim(),
      category,
      amount,
      frequency,
      due_day: day,
      due_month: frequency === 'yearly' ? Number(dueMonth) : null,
      debt_id: category === 'debt' ? debtId || null : null,
      savings_goal_id: category === 'savings' ? goalId || null : null,
      ...(!item && fromYM ? { effective_from: monthStart(fromYM) } : {}),
    }
    setError(null)
    try {
      await save.mutateAsync({ item, input })
      toast.success(item ? 'Item diperbarui' : 'Item ditambahkan')
      onDone()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{item ? 'Edit item budget' : 'Tambah item budget'}</DialogTitle>
        <DialogDescription>
          {item && hasHistory
            ? 'Perubahan berlaku mulai bulan ini. Rencana bulan-bulan sebelumnya tidak berubah.'
            : 'Item rutin yang masuk ke rencana bulanan.'}
        </DialogDescription>
      </DialogHeader>

      <Field label="Nama item" htmlFor="bi-name">
        <Input id="bi-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. Token listrik" autoFocus />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Kategori" htmlFor="bi-cat">
          <NativeSelect id="bi-cat" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.short}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Frekuensi" htmlFor="bi-freq">
          <NativeSelect id="bi-freq" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
            <option value="monthly">Bulanan</option>
            <option value="yearly">Tahunan</option>
          </NativeSelect>
        </Field>
      </div>

      <Field
        label={frequency === 'yearly' ? 'Jumlah per tahun' : 'Jumlah per bulan'}
        htmlFor="bi-amount"
        hint={frequency === 'yearly' && amount ? `Sisihkan ${formatIDR(Math.round(amount / 12))}/bulan` : undefined}
      >
        <MoneyInput id="bi-amount" value={amount} onChange={setAmount} placeholder="0" />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Tgl jatuh tempo" htmlFor="bi-day" hint="Opsional, 1–31">
          <Input id="bi-day" type="number" min={1} max={31} inputMode="numeric" value={dueDay} onChange={(e) => setDueDay(e.target.value)} placeholder="—" />
        </Field>
        {frequency === 'yearly' ? (
          <Field label="Bulan jatuh tempo" htmlFor="bi-month">
            <NativeSelect id="bi-month" value={dueMonth} onChange={(e) => setDueMonth(e.target.value)}>
              {MONTH_NAMES.map((m, idx) => (
                <option key={m} value={idx + 1}>
                  {m}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : !item ? (
          <Field label="Berlaku mulai" htmlFor="bi-from">
            <Input id="bi-from" type="month" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
        ) : (
          <span />
        )}
      </div>

      {category === 'debt' && debts.length > 0 && (
        <Field label="Hubungkan ke hutang" htmlFor="bi-debt" hint="Pembayaran lewat item ini mengurangi sisa hutang.">
          <NativeSelect id="bi-debt" value={debtId} onChange={(e) => setDebtId(e.target.value)}>
            <option value="">— Tidak dihubungkan —</option>
            {debts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}

      {category === 'savings' && goals.length > 0 && (
        <Field label="Hubungkan ke target tabungan" htmlFor="bi-goal">
          <NativeSelect id="bi-goal" value={goalId} onChange={(e) => setGoalId(e.target.value)}>
            <option value="">— Tidak dihubungkan —</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <DialogFooter className="sm:justify-between">
        {item ? (
          <Button type="button" variant="destructive" onClick={() => setConfirm(true)}>
            <Trash2Icon /> Hapus
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Menyimpan…' : 'Simpan'}
        </Button>
      </DialogFooter>

      {item && (
        <ConfirmDialog
          open={confirm}
          onOpenChange={setConfirm}
          title={`Hapus "${item.name}"?`}
          description={
            hasHistory
              ? 'Item tidak lagi masuk rencana mulai bulan ini. Rencana & transaksi bulan sebelumnya tetap tersimpan.'
              : 'Item akan dihapus dari rencana.'
          }
          onConfirm={async () => {
            await del.mutateAsync(item)
            toast.success('Item dihapus')
            onDone()
          }}
        />
      )}
    </form>
  )
}
