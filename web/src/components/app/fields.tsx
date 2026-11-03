import { useState, type ComponentProps, type ReactNode } from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatNumber, parseNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: string
  htmlFor?: string
  hint?: ReactNode
  error?: string | null
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('grid gap-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-negative">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

/** Input nominal rupiah dengan pemisah ribuan otomatis. */
export function MoneyInput({
  value,
  onChange,
  className,
  ...props
}: Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'type'> & {
  value: number | null
  onChange: (v: number | null) => void
}) {
  const [text, setText] = useState(value == null ? '' : formatNumber(value))
  const [synced, setSynced] = useState(value)
  // Sinkronkan kalau nilai diubah dari luar (mis. prefill), tanpa effect.
  if (synced !== value) {
    setSynced(value)
    if (parseNumber(text) !== value) setText(value == null ? '' : formatNumber(value))
  }
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">
        Rp
      </span>
      <Input
        {...props}
        inputMode="numeric"
        autoComplete="off"
        className={cn('pl-9 tabular', className)}
        value={text}
        onChange={(e) => {
          const n = parseNumber(e.target.value)
          setText(n == null ? '' : formatNumber(n))
          onChange(n)
        }}
      />
    </div>
  )
}

/** <select> native: ringan dan paling nyaman di HP. */
export function NativeSelect({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <div className="relative">
      <select
        {...props}
        className={cn(
          'h-8 w-full min-w-0 appearance-none rounded-lg border border-input bg-transparent py-1 pr-8 pl-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30 [&>option]:bg-popover [&>option]:text-popover-foreground',
          className,
        )}
      >
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  )
}
