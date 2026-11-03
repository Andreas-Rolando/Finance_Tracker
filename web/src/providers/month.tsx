import { createContext, useContext, useState, type ReactNode } from 'react'
import { currentYM, type YM } from '@/lib/dates'

const MonthContext = createContext<{ ym: YM; setYm: (ym: YM) => void } | null>(null)

/** Bulan yang sedang dilihat — dipakai bersama oleh Dashboard, Transaksi, Kalender. */
export function MonthProvider({ children }: { children: ReactNode }) {
  const [ym, setYm] = useState<YM>(() => currentYM())
  return <MonthContext.Provider value={{ ym, setYm }}>{children}</MonthContext.Provider>
}

export function useMonth() {
  const ctx = useContext(MonthContext)
  if (!ctx) throw new Error('useMonth must be used inside MonthProvider')
  return ctx
}
