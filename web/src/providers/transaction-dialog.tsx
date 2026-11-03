import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { CategoryDot } from '@/components/app/bits'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { Field, MoneyInput, NativeSelect } from '@/components/app/fields'
import {
  useBudgetItems,
  useDebts,
  useDeleteTransaction,
  useSaveTransaction,
  useSavingsGoals,
} from '@/hooks/api'
import { CATEGORIES } from '@/lib/categories'
import { todayISO } from '@/lib/dates'
import type { BudgetItem, Category, Transaction } from '@/lib/types'
import { cn } from '@/lib/utils'

export type TransactionPrefill = Partial<Omit<Transaction, 'created_at'>>

const EMPTY_ITEMS: BudgetItem[] = []

const Ctx = createContext<{ openTransaction: (prefill?: TransactionPrefill) => void } | null>(null)

export function useTransactionDialog() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTransactionDialog must be used inside TransactionDialogProvider')
  return ctx
}

export function TransactionDialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; prefill: TransactionPrefill; key: number }>({
    open: false,
    prefill: {},
    key: 0,
  })
  const openTransaction = (prefill: TransactionPrefill = {}) =>
    setState((s) => ({ open: true, prefill, key: s.key + 1 }))

  return (
    <Ctx.Provider value={{ openTransaction }}>
      {children}
      <Dialog open={state.open} onOpenChange={(open) => setState((s) => ({ ...s, open }))}>
        <DialogContent className="sm:max-w-md">
          {/* key → form direset setiap kali dialog dibuka */}
          <TransactionForm
            key={state.key}
            prefill={state.prefill}
            onDone={() => setState((s) => ({ ...s, open: false }))}
          />
        </DialogContent>
      </Dialog>
    </Ctx.Provider>
  )
}

/** Item yang berlaku pada tanggal tsb (abaikan frekuensi: item tahunan boleh dibayar kapan saja). */
function itemsOnDate(items: BudgetItem[], date: string, category: Category) {
  return items.filter(
    (i) => i.category === category && i.effective_from <= date && (!i.effective_to || i.effective_to >= date),
  )
}

function TransactionForm({ prefill, onDone }: { prefill: TransactionPrefill; onDone: () => void }) {
  const items = useBudgetItems().data ?? EMPTY_ITEMS
  const debts = (useDebts().data ?? []).filter((d) => d.status === 'active' || d.id === prefill.debt_id)
  const goals = useSavingsGoals().data ?? []
  const save = useSaveTransaction()
  const del = useDeleteTransaction()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const [date, setDate] = useState(prefill.date ?? todayISO())
  const [amount, setAmount] = useState<number | null>(prefill.amount ?? null)
  const [category, setCategory] = useState<Category>(prefill.category ?? 'household')
  const [itemId, setItemId] = useState(prefill.budget_item_id ?? '')
  const [debtId, setDebtId] = useState(prefill.debt_id ?? '')
  const [goalId, setGoalId] = useState(prefill.savings_goal_id ?? '')
  const [note, setNote] = useState(prefill.note ?? '')
  const [error, setError] = useState<string | null>(null)

  const options = useMemo(() => {
    const list = itemsOnDate(items, date, category)
    // Pastikan item yang sedang terpilih tetap ada di daftar (mis. saat edit transaksi lama).
    const selected = items.find((i) => i.id === itemId)
    if (selected && !list.includes(selected)) list.push(selected)
    return list
  }, [items, date, category, itemId])

  const isEdit = Boolean(prefill.id)

  function pickCategory(c: Category) {
    setCategory(c)
    setItemId('')
    setDebtId('')
    setGoalId('')
  }

  function pickItem(id: string) {
    setItemId(id)
    const it = items.find((i) => i.id === id)
    if (it?.debt_id) setDebtId(it.debt_id)
    if (it?.savings_goal_id) setGoalId(it.savings_goal_id)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!amount || amount <= 0) return setError('Nominal harus lebih dari 0')
    if (!date) return setError('Tanggal wajib diisi')
    setError(null)
    try {
      await save.mutateAsync({
        id: prefill.id,
        date,
        amount,
        category,
        budget_item_id: itemId || null,
        debt_id: category === 'debt' ? debtId || null : null,
        savings_goal_id: category === 'savings' ? goalId || null : null,
        note: note.trim() || null,
      })
      toast.success(isEdit ? 'Transaksi diperbarui' : 'Transaksi dicatat')
      onDone()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Edit transaksi' : 'Catat transaksi'}</DialogTitle>
        <DialogDescription>Realisasi pemasukan atau pengeluaran.</DialogDescription>
      </DialogHeader>

      <Field label="Nominal" htmlFor="tx-amount">
        <MoneyInput id="tx-amount" autoFocus value={amount} onChange={setAmount} placeholder="0" className="h-10 text-base" />
      </Field>

      <div className="grid gap-1.5">
        <span className="text-sm font-medium">Kategori</span>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3" role="radiogroup" aria-label="Kategori">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              role="radio"
              aria-checked={category === c.key}
              onClick={() => pickCategory(c.key)}
              className={cn(
                'flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs font-medium transition-colors',
                category === c.key ? 'border-foreground bg-muted' : 'hover:bg-muted/60',
              )}
            >
              <CategoryDot category={c.key} />
              {c.short}
            </button>
          ))}
        </div>
      </div>

      <Field label="Item budget" htmlFor="tx-item" hint={options.length === 0 ? 'Belum ada item di kategori ini — boleh dikosongkan.' : undefined}>
        <NativeSelect id="tx-item" value={itemId} onChange={(e) => pickItem(e.target.value)}>
          <option value="">— Lainnya / tanpa item —</option>
          {options.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </NativeSelect>
      </Field>

      {category === 'debt' && (
        <Field label="Hutang yang dibayar" htmlFor="tx-debt" hint="Mengurangi sisa hutang secara otomatis.">
          <NativeSelect id="tx-debt" value={debtId} onChange={(e) => setDebtId(e.target.value)}>
            <option value="">— Pilih hutang —</option>
            {debts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}

      {category === 'savings' && (
        <Field label="Target tabungan" htmlFor="tx-goal" hint="Menambah progres target tabungan.">
          <NativeSelect id="tx-goal" value={goalId} onChange={(e) => setGoalId(e.target.value)}>
            <option value="">— Pilih target —</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[10rem_1fr]">
        <Field label="Tanggal" htmlFor="tx-date">
          <Input id="tx-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Keterangan" htmlFor="tx-note">
          <Textarea id="tx-note" rows={1} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opsional" className="min-h-8" />
        </Field>
      </div>

      {error && <p className="text-sm text-negative">{error}</p>}

      <DialogFooter className="sm:justify-between">
        {isEdit ? (
          <Button type="button" variant="destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2Icon /> Hapus
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Menyimpan…' : 'Simpan'}
        </Button>
      </DialogFooter>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Hapus transaksi ini?"
        description="Transaksi yang dihapus tidak bisa dikembalikan."
        onConfirm={async () => {
          await del.mutateAsync(prefill.id!)
          toast.success('Transaksi dihapus')
          onDone()
        }}
      />
    </form>
  )
}
