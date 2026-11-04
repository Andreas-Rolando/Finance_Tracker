import { BanknoteIcon, CreditCardIcon, PiggyBankIcon, ReceiptTextIcon, ShoppingCartIcon, type LucideIcon } from 'lucide-react'
import { CATEGORY_MAP } from '@/lib/categories'
import type { Category } from '@/lib/types'
import { cn } from '@/lib/utils'

const ICONS: Record<Category, LucideIcon> = {
  income: BanknoteIcon,
  savings: PiggyBankIcon,
  bills: ReceiptTextIcon,
  household: ShoppingCartIcon,
  debt: CreditCardIcon,
}

/** Kotak ikon kategori dengan warna tint dari palet kategorikal (aman di mode terang & gelap). */
export function CategoryTile({ category, size = 'md', className }: { category: Category; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const Icon = ICONS[category]
  const color = CATEGORY_MAP[category].colorVar
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center',
        size === 'sm' && 'size-7 rounded-lg [&_svg]:size-3.5',
        size === 'md' && 'size-8 rounded-[10px] [&_svg]:size-4',
        size === 'lg' && 'size-10 rounded-xl [&_svg]:size-[18px]',
        className,
      )}
      style={{
        background: `color-mix(in oklab, ${color} 16%, transparent)`,
        color: `color-mix(in oklab, ${color} 72%, var(--foreground))`,
      }}
    >
      <Icon />
    </span>
  )
}
