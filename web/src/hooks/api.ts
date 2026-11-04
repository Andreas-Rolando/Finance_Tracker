import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { monthEnd, monthStart, prevMonth, currentYM, type YM } from '@/lib/dates'
import { supabase, unwrap } from '@/lib/supabase'
import type {
  AnnualGoal,
  Household,
  HouseholdMember,
  HouseholdInvite,
  TelegramAccount,
  TelegramGroup,
  BudgetItem,
  Debt,
  DebtPaid,
  MonthlyActual,
  MonthSetting,
  Profile,
  SavingsGoal,
  SavingsPaid,
  Transaction,
} from '@/lib/types'

// ------------------------------------------------------------------ keys

export const qk = {
  budgetItems: ['budget_items'] as const,
  transactions: (ym: YM) => ['transactions', ym.year, ym.month] as const,
  transactionsAll: ['transactions'] as const,
  debts: ['debts'] as const,
  debtPaid: ['debt_paid'] as const,
  savings: ['savings_goals'] as const,
  savingsPaid: ['savings_paid'] as const,
  monthlyActuals: ['monthly_actuals'] as const,
  monthSettings: ['month_settings'] as const,
  annualGoals: (year: number) => ['annual_goals', year] as const,
  profile: ['profile'] as const,
  household: ['household'] as const,
  telegram: ['telegram'] as const,
}

const num = (v: unknown) => (v == null ? 0 : Number(v))
const numOrNull = (v: unknown) => (v == null ? null : Number(v))

// ------------------------------------------------------------------ queries

export function useBudgetItems() {
  return useQuery({
    queryKey: qk.budgetItems,
    queryFn: async () => {
      const rows = unwrap(await supabase.from('budget_items').select('*').order('created_at'))
      return (rows as BudgetItem[]).map((r) => ({ ...r, amount: num(r.amount) }))
    },
  })
}

export function useTransactions(ym: YM) {
  return useQuery({
    queryKey: qk.transactions(ym),
    queryFn: async () => {
      const rows = unwrap(
        await supabase
          .from('transactions')
          .select('*')
          .gte('date', monthStart(ym))
          .lte('date', monthEnd(ym))
          .order('date', { ascending: false })
          .order('created_at', { ascending: false }),
      )
      return (rows as Transaction[]).map((r) => ({ ...r, amount: num(r.amount) }))
    },
  })
}

export function useDebts() {
  return useQuery({
    queryKey: qk.debts,
    queryFn: async () => {
      const rows = unwrap(await supabase.from('debts').select('*').order('created_at'))
      return (rows as Debt[]).map((d) => ({
        ...d,
        principal: num(d.principal),
        monthly_installment: num(d.monthly_installment),
        interest_rate_monthly: numOrNull(d.interest_rate_monthly),
      }))
    },
  })
}

export function useDebtPaid() {
  return useQuery({
    queryKey: qk.debtPaid,
    queryFn: async () => {
      const rows = unwrap(await supabase.from('v_debt_paid').select('*')) as DebtPaid[]
      return new Map(rows.map((r) => [r.debt_id, { ...r, paid: num(r.paid) }]))
    },
  })
}

export function useSavingsGoals() {
  return useQuery({
    queryKey: qk.savings,
    queryFn: async () => {
      const rows = unwrap(await supabase.from('savings_goals').select('*').order('created_at'))
      return (rows as SavingsGoal[]).map((g) => ({
        ...g,
        target_amount: num(g.target_amount),
        initial_amount: num(g.initial_amount),
        monthly_plan: num(g.monthly_plan),
      }))
    },
  })
}

export function useSavingsPaid() {
  return useQuery({
    queryKey: qk.savingsPaid,
    queryFn: async () => {
      const rows = unwrap(await supabase.from('v_savings_paid').select('*')) as SavingsPaid[]
      return new Map(rows.map((r) => [r.savings_goal_id, num(r.paid)]))
    },
  })
}

export function useMonthlyActuals() {
  return useQuery({
    queryKey: qk.monthlyActuals,
    queryFn: async () => {
      const rows = unwrap(await supabase.from('v_monthly_actual').select('*')) as MonthlyActual[]
      return rows.map((r) => ({ ...r, total: num(r.total) }))
    },
  })
}

export function useMonthSettings() {
  return useQuery({
    queryKey: qk.monthSettings,
    queryFn: async () =>
      unwrap(await supabase.from('month_settings').select('year, month, carry_over')) as MonthSetting[],
  })
}

export function useAnnualGoals(year: number) {
  return useQuery({
    queryKey: qk.annualGoals(year),
    queryFn: async () =>
      unwrap(await supabase.from('annual_goals').select('*').eq('year', year).order('created_at')) as AnnualGoal[],
  })
}

export function useProfile(userId: string | undefined) {
  return useQuery({
    queryKey: qk.profile,
    enabled: Boolean(userId),
    queryFn: async () =>
      unwrap(await supabase.from('profiles').select('id, full_name, email, avatar_url').eq('id', userId!).maybeSingle()) as Profile | null,
  })
}

// ------------------------------------------------------------------ invalidation

function invalidateMoney(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: qk.transactionsAll }),
    qc.invalidateQueries({ queryKey: qk.monthlyActuals }),
    qc.invalidateQueries({ queryKey: qk.debtPaid }),
    qc.invalidateQueries({ queryKey: qk.savingsPaid }),
  ])
}

function invalidatePlans(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: qk.budgetItems }),
    qc.invalidateQueries({ queryKey: qk.debts }),
    qc.invalidateQueries({ queryKey: qk.savings }),
  ])
}

// ------------------------------------------------------------------ transactions

export type TransactionInput = Omit<Transaction, 'id' | 'created_at' | 'user_id' | 'source'>

export function useSaveTransaction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...input }: TransactionInput & { id?: string }) => {
      if (id) unwrap(await supabase.from('transactions').update(input).eq('id', id).select('id'))
      else unwrap(await supabase.from('transactions').insert(input).select('id'))
    },
    onSuccess: () => invalidateMoney(qc),
  })
}

export function useDeleteTransaction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await supabase.from('transactions').delete().eq('id', id).select('id'))
    },
    onSuccess: () => invalidateMoney(qc),
  })
}

// ------------------------------------------------------------------ budget items

export type BudgetItemInput = Pick<
  BudgetItem,
  'name' | 'category' | 'amount' | 'frequency' | 'due_day' | 'due_month' | 'debt_id' | 'savings_goal_id'
> & { effective_from?: string }

const EDITABLE: (keyof BudgetItemInput)[] = [
  'name', 'category', 'amount', 'frequency', 'due_day', 'due_month', 'debt_id', 'savings_goal_id',
]

async function insertBudgetItem(input: BudgetItemInput) {
  unwrap(
    await supabase
      .from('budget_items')
      .insert({ ...input, effective_from: input.effective_from ?? monthStart(currentYM()) })
      .select('id'),
  )
}

/**
 * Edit budget item. Kalau item sudah berlaku sejak bulan lalu, versi lama ditutup
 * di akhir bulan lalu dan dibuat versi baru mulai bulan ini — rencana bulan lalu
 * tidak ikut berubah. Transaksi bulan ini & seterusnya dipindah ke versi baru.
 */
export async function updateBudgetItem(item: BudgetItem, changes: Partial<BudgetItemInput>) {
  const cur = currentYM()
  const start = monthStart(cur)
  const changed = EDITABLE.some((k) => k in changes && changes[k] !== item[k])
  if (!changed) return
  if (item.effective_from >= start) {
    unwrap(await supabase.from('budget_items').update(changes).eq('id', item.id).select('id'))
    return
  }
  const next: BudgetItemInput = {
    name: item.name,
    category: item.category,
    amount: item.amount,
    frequency: item.frequency,
    due_day: item.due_day,
    due_month: item.due_month,
    debt_id: item.debt_id,
    savings_goal_id: item.savings_goal_id,
    ...changes,
  }
  const created = unwrap(
    await supabase
      .from('budget_items')
      .insert({ ...next, effective_from: start, effective_to: item.effective_to })
      .select('id')
      .single(),
  ) as { id: string }
  unwrap(
    await supabase
      .from('budget_items')
      .update({ effective_to: monthEnd(prevMonth(cur)) })
      .eq('id', item.id)
      .select('id'),
  )
  unwrap(
    await supabase
      .from('transactions')
      .update({ budget_item_id: created.id })
      .eq('budget_item_id', item.id)
      .gte('date', start)
      .select('id'),
  )
}

/** Hapus item: kalau sudah punya riwayat, cukup diakhiri di bulan lalu. */
export async function removeBudgetItem(item: BudgetItem) {
  const cur = currentYM()
  const start = monthStart(cur)
  if (item.effective_from >= start) {
    unwrap(await supabase.from('budget_items').delete().eq('id', item.id).select('id'))
    return
  }
  unwrap(
    await supabase
      .from('budget_items')
      .update({ effective_to: monthEnd(prevMonth(cur)) })
      .eq('id', item.id)
      .select('id'),
  )
  unwrap(
    await supabase
      .from('transactions')
      .update({ budget_item_id: null })
      .eq('budget_item_id', item.id)
      .gte('date', start)
      .select('id'),
  )
}

export function useSaveBudgetItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ item, input }: { item?: BudgetItem; input: BudgetItemInput }) => {
      if (item) await updateBudgetItem(item, input)
      else await insertBudgetItem(input)
    },
    onSuccess: () => Promise.all([invalidatePlans(qc), invalidateMoney(qc)]),
  })
}

export function useDeleteBudgetItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: removeBudgetItem,
    onSuccess: () => Promise.all([invalidatePlans(qc), invalidateMoney(qc)]),
  })
}

// ------------------------------------------------------------------ debts

export type DebtInput = Omit<Debt, 'id' | 'created_at' | 'status'>

/** Budget item aktif yang terhubung ke hutang/tabungan tertentu. */
async function linkedActiveItems(column: 'debt_id' | 'savings_goal_id', id: string) {
  const start = monthStart(currentYM())
  const rows = unwrap(
    await supabase
      .from('budget_items')
      .select('*')
      .eq(column, id)
      .or(`effective_to.is.null,effective_to.gte.${start}`),
  ) as BudgetItem[]
  return rows.map((r) => ({ ...r, amount: num(r.amount) }))
}

export function useSaveDebt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input, addToBudget }: { id?: string; input: DebtInput; addToBudget: boolean }) => {
      if (id) {
        unwrap(await supabase.from('debts').update(input).eq('id', id).select('id'))
        for (const it of await linkedActiveItems('debt_id', id)) {
          await updateBudgetItem(it, { name: input.name, amount: input.monthly_installment, due_day: input.due_day })
        }
        return
      }
      const created = unwrap(await supabase.from('debts').insert(input).select('id').single()) as { id: string }
      if (addToBudget && input.monthly_installment > 0) {
        await insertBudgetItem({
          name: input.name,
          category: 'debt',
          amount: input.monthly_installment,
          frequency: 'monthly',
          due_day: input.due_day,
          due_month: null,
          debt_id: created.id,
          savings_goal_id: null,
        })
      }
    },
    onSuccess: () => invalidatePlans(qc),
  })
}

export function useSetDebtStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Debt['status'] }) => {
      unwrap(await supabase.from('debts').update({ status }).eq('id', id).select('id'))
      if (status === 'archived') {
        for (const it of await linkedActiveItems('debt_id', id)) await removeBudgetItem(it)
      }
    },
    onSuccess: () => Promise.all([invalidatePlans(qc), invalidateMoney(qc)]),
  })
}

export function useDeleteDebt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      for (const it of await linkedActiveItems('debt_id', id)) await removeBudgetItem(it)
      unwrap(await supabase.from('debts').delete().eq('id', id).select('id'))
    },
    onSuccess: () => Promise.all([invalidatePlans(qc), invalidateMoney(qc)]),
  })
}

// ------------------------------------------------------------------ savings

export type SavingsInput = Omit<SavingsGoal, 'id' | 'created_at'>

export function useSaveSavingsGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      input,
      addToBudget,
      dueDay,
    }: {
      id?: string
      input: SavingsInput
      addToBudget: boolean
      dueDay: number | null
    }) => {
      if (id) {
        unwrap(await supabase.from('savings_goals').update(input).eq('id', id).select('id'))
        for (const it of await linkedActiveItems('savings_goal_id', id)) {
          await updateBudgetItem(it, { name: input.name, amount: input.monthly_plan })
        }
        return
      }
      const created = unwrap(await supabase.from('savings_goals').insert(input).select('id').single()) as {
        id: string
      }
      if (addToBudget && input.monthly_plan > 0) {
        await insertBudgetItem({
          name: input.name,
          category: 'savings',
          amount: input.monthly_plan,
          frequency: 'monthly',
          due_day: dueDay,
          due_month: null,
          debt_id: null,
          savings_goal_id: created.id,
        })
      }
    },
    onSuccess: () => invalidatePlans(qc),
  })
}

export function useDeleteSavingsGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      for (const it of await linkedActiveItems('savings_goal_id', id)) await removeBudgetItem(it)
      unwrap(await supabase.from('savings_goals').delete().eq('id', id).select('id'))
    },
    onSuccess: () => Promise.all([invalidatePlans(qc), invalidateMoney(qc)]),
  })
}

// ------------------------------------------------------------------ month settings

export function useSetCarryOver() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ym, carry_over }: { ym: YM; carry_over: boolean }) => {
      unwrap(
        await supabase
          .from('month_settings')
          .upsert({ year: ym.year, month: ym.month, carry_over }, { onConflict: 'household_id,year,month' })
          .select('year'),
      )
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.monthSettings }),
  })
}

// ------------------------------------------------------------------ annual goals

export function useAnnualGoalMutations(year: number) {
  const qc = useQueryClient()
  const onSuccess = () => qc.invalidateQueries({ queryKey: qk.annualGoals(year) })
  return {
    add: useMutation({
      mutationFn: async (title: string) => {
        unwrap(await supabase.from('annual_goals').insert({ year, title }).select('id'))
      },
      onSuccess,
    }),
    toggle: useMutation({
      mutationFn: async ({ id, is_done }: { id: string; is_done: boolean }) => {
        unwrap(await supabase.from('annual_goals').update({ is_done }).eq('id', id).select('id'))
      },
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: async (id: string) => {
        unwrap(await supabase.from('annual_goals').delete().eq('id', id).select('id'))
      },
      onSuccess,
    }),
  }
}

// ------------------------------------------------------------------ profile

export function useUpdateProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, full_name }: { id: string; full_name: string }) => {
      unwrap(await supabase.from('profiles').update({ full_name }).eq('id', id).select('id'))
    },
    onSuccess: () =>
      Promise.all([qc.invalidateQueries({ queryKey: qk.profile }), qc.invalidateQueries({ queryKey: qk.household })]),
  })
}

// ------------------------------------------------------------------ household

export function useHousehold() {
  return useQuery({
    queryKey: qk.household,
    queryFn: async (): Promise<Household | null> => {
      const raw = unwrap(
        await supabase.from('households').select('id, name, notify_threshold, reminders_enabled, budget_alerts_enabled, summaries_enabled').maybeSingle(),
      ) as Omit<Household, 'members' | 'invites'> | null
      if (!raw) return null
      const h = { ...raw, notify_threshold: num(raw.notify_threshold) }
      const members = unwrap(
        await supabase
          .from('household_members')
          .select('user_id, role, profile:profiles(id, full_name, email, avatar_url)')
          .order('created_at'),
      ) as unknown as HouseholdMember[]
      const invites = unwrap(
        await supabase.from('household_invites').select('email, created_at').order('created_at'),
      ) as HouseholdInvite[]
      return { ...h, members, invites }
    },
  })
}

/** Nama pendek anggota untuk label "dicatat oleh". */
export function memberName(household: Household | null | undefined, userId: string | null): string | null {
  if (!household || !userId) return null
  const m = household.members.find((x) => x.user_id === userId)
  if (!m) return null
  return m.profile?.full_name?.split(' ')[0] || m.profile?.email?.split('@')[0] || null
}

export function useHouseholdMutations() {
  const qc = useQueryClient()
  const onSuccess = () => qc.invalidateQueries({ queryKey: qk.household })
  return {
    invite: useMutation({
      mutationFn: async ({ householdId, email }: { householdId: string; email: string }) => {
        unwrap(
          await supabase
            .from('household_invites')
            .insert({ household_id: householdId, email: email.trim().toLowerCase() })
            .select('email'),
        )
      },
      onSuccess,
    }),
    cancelInvite: useMutation({
      mutationFn: async (email: string) => {
        unwrap(await supabase.from('household_invites').delete().eq('email', email).select('email'))
      },
      onSuccess,
    }),
    updateSettings: useMutation({
      mutationFn: async ({
        id,
        ...changes
      }: {
        id: string
        notify_threshold?: number
        reminders_enabled?: boolean
        budget_alerts_enabled?: boolean
        summaries_enabled?: boolean
      }) => {
        unwrap(await supabase.from('households').update(changes).eq('id', id).select('id'))
      },
      onSuccess,
    }),
    rename: useMutation({
      mutationFn: async ({ id, name }: { id: string; name: string }) => {
        unwrap(await supabase.from('households').update({ name }).eq('id', id).select('id'))
      },
      onSuccess,
    }),
  }
}

// ------------------------------------------------------------------ telegram

export function useTelegram(opts: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: qk.telegram,
    refetchInterval: opts.poll ? 3000 : false,
    queryFn: async () => {
      const [accounts, group] = await Promise.all([
        supabase.from('telegram_accounts').select('user_id, username, first_name, linked_at'),
        supabase.from('telegram_groups').select('chat_id, title, linked_at').maybeSingle(),
      ])
      return {
        accounts: unwrap(accounts) as TelegramAccount[],
        group: unwrap(group) as TelegramGroup | null,
      }
    },
  })
}

export function useTelegramMutations() {
  const qc = useQueryClient()
  const onSuccess = () => qc.invalidateQueries({ queryKey: qk.telegram })
  return {
    createCode: useMutation({
      mutationFn: async (kind: 'account' | 'group') => {
        const rows = unwrap(await supabase.rpc('create_telegram_link_code', { p_kind: kind })) as {
          code: string
          expires_at: string
        }[]
        if (!rows?.[0]) throw new Error('Gagal membuat kode')
        return rows[0]
      },
    }),
    unlinkAccount: useMutation({
      mutationFn: async (userId: string) => {
        unwrap(await supabase.from('telegram_accounts').delete().eq('user_id', userId).select('user_id'))
      },
      onSuccess,
    }),
    unlinkGroup: useMutation({
      mutationFn: async (chatId: number) => {
        unwrap(await supabase.from('telegram_groups').delete().eq('chat_id', chatId).select('chat_id'))
      },
      onSuccess,
    }),
  }
}

// ------------------------------------------------------------------ export

export async function exportAllData() {
  const tables = ['budget_items', 'transactions', 'debts', 'savings_goals', 'month_settings', 'annual_goals'] as const
  const out: Record<string, unknown> = { exported_at: new Date().toISOString(), version: 1 }
  for (const t of tables) {
    // Ambil per halaman supaya tidak terpotong limit 1000 baris dari PostgREST.
    const all: unknown[] = []
    for (let from = 0; ; from += 1000) {
      const rows = unwrap(await supabase.from(t).select('*').range(from, from + 999)) as unknown[]
      all.push(...rows)
      if (rows.length < 1000) break
    }
    out[t] = all
  }
  return out
}
