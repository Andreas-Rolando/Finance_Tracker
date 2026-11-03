import { Suspense } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import {
  CalendarDaysIcon,
  ChartColumnIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CreditCardIcon,
  LayoutDashboardIcon,
  ListIcon,
  MenuIcon,
  PiggyBankIcon,
  PlusIcon,
  SettingsIcon,
  WalletIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { compareYM, currentYM, formatMonth, nextMonth, prevMonth } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useMonth } from '@/providers/month'
import { useTransactionDialog } from '@/providers/transaction-dialog'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboardIcon },
  { to: '/transaksi', label: 'Transaksi', icon: ListIcon },
  { to: '/budget', label: 'Budget', icon: WalletIcon },
  { to: '/hutang', label: 'Hutang', icon: CreditCardIcon },
  { to: '/tabungan', label: 'Tabungan', icon: PiggyBankIcon },
  { to: '/kalender', label: 'Kalender', icon: CalendarDaysIcon },
  { to: '/tahunan', label: 'Tahunan', icon: ChartColumnIcon },
  { to: '/pengaturan', label: 'Pengaturan', icon: SettingsIcon },
]

const MOBILE_PRIMARY = ['/', '/transaksi', '/hutang']

export function AppLayout() {
  const { openTransaction } = useTransactionDialog()
  const navigate = useNavigate()

  return (
    <div className="min-h-dvh bg-background">
      {/* Sidebar — desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-sidebar px-3 py-5 md:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <div className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <WalletIcon className="size-4" />
          </div>
          <span className="font-semibold tracking-tight">Finance Tracker</span>
        </div>
        <Button className="mb-4 w-full justify-start" onClick={() => openTransaction()}>
          <PlusIcon /> Catat transaksi
        </Button>
        <nav className="grid gap-0.5">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                    : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
                )
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="px-4 pt-5 pb-28 sm:px-6 md:ml-60 md:px-8 md:pt-8 md:pb-12">
        <div className="mx-auto max-w-5xl">
          <Suspense fallback={<Skeleton className="h-40 rounded-xl" />}>
            <Outlet />
          </Suspense>
        </div>
      </main>

      {/* Bottom nav — mobile */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5 items-center">
          {NAV.filter((n) => MOBILE_PRIMARY.includes(n.to))
            .slice(0, 2)
            .map((n) => (
              <MobileLink key={n.to} {...n} />
            ))}
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => openTransaction()}
              aria-label="Catat transaksi"
              className="-mt-6 grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background active:scale-95"
            >
              <PlusIcon className="size-6" />
            </button>
          </div>
          <MobileLink {...NAV[3]} />
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex flex-col items-center gap-0.5 py-2.5 text-[11px] text-muted-foreground"
              aria-label="Menu lainnya"
            >
              <MenuIcon className="size-5" />
              Menu
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="w-48">
              {NAV.filter((n) => !MOBILE_PRIMARY.includes(n.to)).map(({ to, label, icon: Icon }) => (
                <DropdownMenuItem key={to} onClick={() => navigate(to)} className="py-2">
                  <Icon /> {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </nav>
    </div>
  )
}

function MobileLink({ to, label, icon: Icon }: (typeof NAV)[number]) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        cn(
          'flex flex-col items-center gap-0.5 py-2.5 text-[11px]',
          isActive ? 'font-medium text-foreground' : 'text-muted-foreground',
        )
      }
    >
      <Icon className="size-5" />
      {label}
    </NavLink>
  )
}

export function MonthPicker() {
  const { ym, setYm } = useMonth()
  const isCurrent = compareYM(ym, currentYM()) === 0
  return (
    <div className="flex items-center gap-1">
      <Button variant="outline" size="icon" onClick={() => setYm(prevMonth(ym))} aria-label="Bulan sebelumnya">
        <ChevronLeftIcon />
      </Button>
      <span className="min-w-36 text-center text-sm font-medium tabular">{formatMonth(ym)}</span>
      <Button variant="outline" size="icon" onClick={() => setYm(nextMonth(ym))} aria-label="Bulan berikutnya">
        <ChevronRightIcon />
      </Button>
      {!isCurrent && (
        <Button variant="ghost" size="sm" onClick={() => setYm(currentYM())}>
          Bulan ini
        </Button>
      )}
    </div>
  )
}
