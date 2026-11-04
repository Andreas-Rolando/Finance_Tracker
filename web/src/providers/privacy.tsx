import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { formatIDR } from '@/lib/format'

const KEY = 'ft.hideAmounts'
const MASK = 'Rp ••••••'

const Ctx = createContext<{ hidden: boolean; toggle: () => void } | null>(null)

function readStored(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/** Mode privasi: sembunyikan nominal (mis. saat membuka aplikasi di depan orang lain). Diingat per browser. */
export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(readStored)
  const toggle = useCallback(() => {
    setHidden((h) => {
      try {
        localStorage.setItem(KEY, h ? '0' : '1')
      } catch {
        /* storage tidak tersedia — cukup di memori */
      }
      return !h
    })
  }, [])
  return <Ctx.Provider value={{ hidden, toggle }}>{children}</Ctx.Provider>
}

export function usePrivacy() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('usePrivacy must be used inside PrivacyProvider')
  return ctx
}

/** Formatter rupiah yang menghormati mode privasi. */
export function useMoney() {
  const { hidden } = usePrivacy()
  return useCallback((n: number) => (hidden ? MASK : formatIDR(n)), [hidden])
}
