import { lazy, type ComponentType } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { Skeleton } from '@/components/ui/skeleton'
import { AppLayout } from '@/components/app/AppLayout'
import { isSupabaseConfigured } from '@/lib/supabase'
import { LoginPage, SetupRequiredPage } from '@/pages/AuthPages'
import { AuthProvider, useAuth } from '@/providers/auth'
import { MonthProvider } from '@/providers/month'
import { PrivacyProvider } from '@/providers/privacy'
import { RealtimeSync } from '@/providers/realtime'
import { TransactionDialogProvider } from '@/providers/transaction-dialog'

const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })))

const DashboardPage = page(() => import('@/pages/DashboardPage'), 'DashboardPage')
const TransactionsPage = page(() => import('@/pages/TransactionsPage'), 'TransactionsPage')
const BudgetPage = page(() => import('@/pages/BudgetPage'), 'BudgetPage')
const DebtsPage = page(() => import('@/pages/DebtsPage'), 'DebtsPage')
const SavingsPage = page(() => import('@/pages/SavingsPage'), 'SavingsPage')
const CalendarPage = page(() => import('@/pages/CalendarPage'), 'CalendarPage')
const AnnualPage = page(() => import('@/pages/AnnualPage'), 'AnnualPage')
const SettingsPage = page(() => import('@/pages/SettingsPage'), 'SettingsPage')

function Gate() {
  const { session, loading } = useAuth()
  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Skeleton className="h-8 w-40" />
      </div>
    )
  }
  if (!session) return <LoginPage />
  return (
    <PrivacyProvider>
    <MonthProvider>
      <RealtimeSync userId={session.user.id} />
      <TransactionDialogProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="transaksi" element={<TransactionsPage />} />
              <Route path="budget" element={<BudgetPage />} />
              <Route path="hutang" element={<DebtsPage />} />
              <Route path="tabungan" element={<SavingsPage />} />
              <Route path="kalender" element={<CalendarPage />} />
              <Route path="tahunan" element={<AnnualPage />} />
              <Route path="pengaturan" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </TransactionDialogProvider>
    </MonthProvider>
    </PrivacyProvider>
  )
}

export default function App() {
  if (!isSupabaseConfigured) return <SetupRequiredPage />
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}
