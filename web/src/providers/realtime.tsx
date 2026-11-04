import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { memberName, qk } from '@/hooks/api'
import { CATEGORY_MAP } from '@/lib/categories'
import { formatIDR } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import type { Category, Household } from '@/lib/types'

/** Tabel → query yang perlu dimuat ulang. */
const KEYS: Record<string, readonly (readonly unknown[])[]> = {
  transactions: [qk.transactionsAll, qk.monthlyActuals, qk.debtPaid, qk.savingsPaid],
  budget_items: [qk.budgetItems],
  debts: [qk.debts, qk.debtPaid],
  savings_goals: [qk.savings, qk.savingsPaid],
  month_settings: [qk.monthSettings],
}

/**
 * Sinkron realtime: perubahan dari anggota lain (web atau Telegram) langsung
 * muncul tanpa refresh. Supabase Realtime menghormati RLS, jadi hanya data
 * rumah tangga sendiri yang diterima.
 */
export function RealtimeSync({ userId }: { userId: string }) {
  const qc = useQueryClient()

  useEffect(() => {
    const pending = new Set<string>()
    let timer: ReturnType<typeof setTimeout> | undefined
    const flush = () => {
      for (const table of pending) for (const key of KEYS[table]) void qc.invalidateQueries({ queryKey: key })
      pending.clear()
    }
    const schedule = (table: string) => {
      pending.add(table)
      clearTimeout(timer)
      timer = setTimeout(flush, 400) // gabungkan beberapa perubahan beruntun
    }

    const channel = supabase.channel(`household-sync-${userId}`)
    for (const table of Object.keys(KEYS)) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
        schedule(table)
        if (table !== 'transactions' || payload.eventType !== 'INSERT') return
        const row = payload.new as { user_id?: string; amount?: number; category?: Category; source?: string; note?: string }
        if (!row.user_id || row.user_id === userId) return
        const who = memberName(qc.getQueryData<Household | null>(qk.household), row.user_id) ?? 'Anggota'
        const via = row.source === 'telegram' ? ' via Telegram' : ''
        toast(`${who} mencatat ${formatIDR(Number(row.amount ?? 0))}${via}`, {
          description: [row.category ? CATEGORY_MAP[row.category].short : null, row.note].filter(Boolean).join(' · '),
        })
      })
    }
    channel.subscribe()

    return () => {
      clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [qc, userId])

  return null
}
