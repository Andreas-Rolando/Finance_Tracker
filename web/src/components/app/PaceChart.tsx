import { useRef, useState } from 'react'
import { formatCompact } from '@/lib/format'

const W = 760
const H = 220
const L = 48 // ruang label sumbu Y
const R = 16
const T = 14
const B = 34 // ruang label sumbu X

function niceMax(v: number): number {
  if (v <= 0) return 1_000_000
  const exp = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * exp >= v) return m * exp
  return 10 * exp
}

/**
 * Grafik laju pengeluaran: kumulatif realisasi per hari vs rencana kumulatif yang mengikuti
 * jadwal (berundak di tanggal jatuh tempo).
 * SVG ringan (tanpa library chart) + tooltip hover/sentuh.
 */
export function PaceChart({
  series,
  plan,
  todayDay,
  money,
  hidden,
}: {
  /** Kumulatif per hari; null = belum terjadi. */
  series: (number | null)[]
  /** Rencana kumulatif per hari (index 0 = tanggal 1). */
  plan: number[]
  /** Penanda "hari ini" (null untuk bulan lain). */
  todayDay: number | null
  money: (n: number) => string
  hidden: boolean
}) {
  const days = series.length
  const lastActual = [...series].reverse().find((v) => v != null) ?? 0
  const planTotal = plan[plan.length - 1] ?? 0
  const yMax = niceMax(Math.max(planTotal, lastActual) * 1.05)
  const x = (day: number) => L + ((day - 1) / Math.max(days - 1, 1)) * (W - L - R)
  const y = (v: number) => T + (1 - v / yMax) * (H - T - B)
  const planAt = (day: number) => plan[day - 1] ?? 0
  // Garis berundak: naik vertikal tepat di tanggal jatuh tempo.
  const planPath = plan
    .map((v, i) => {
      const px = x(i + 1)
      const prev = i === 0 ? 0 : plan[i - 1]
      return `${i === 0 ? 'M' : 'L'}${px},${y(prev)} L${px},${y(v)}`
    })
    .join(' ')

  const points = series.map((v, i) => (v == null ? null : ([x(i + 1), y(v)] as const))).filter(Boolean) as (readonly [number, number])[]
  const line = points.map((p) => p.join(',')).join(' ')
  const area = points.length ? `${points[0][0]},${y(0)} ${line} ${points[points.length - 1][0]},${y(0)}` : ''
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax)
  const xTicks = [1, 8, 15, 22, days]

  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const active = hover ?? null

  const onMove = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const sx = ((clientX - rect.left) / rect.width) * W
    const day = Math.round(((sx - L) / (W - L - R)) * (days - 1)) + 1
    setHover(Math.min(Math.max(day, 1), days))
  }

  const summaryDay = todayDay ?? days
  const summary = hidden
    ? 'Grafik laju pengeluaran (nominal disembunyikan)'
    : `Pengeluaran kumulatif ${money(lastActual)} sampai tanggal ${summaryDay}, rencana s/d tanggal itu ${money(planAt(summaryDay))}`

  const tip = active != null ? { day: active, actual: series[active - 1], plan: planAt(active) } : null
  const tipX = tip ? Math.min(Math.max(x(tip.day) + 10, L), W - 190) : 0

  return (
    <svg
      ref={svgRef}
      role="img"
      aria-label={summary}
      viewBox={`0 0 ${W} ${H}`}
      className="block h-auto w-full touch-pan-y select-none"
      onMouseMove={(e) => onMove(e.clientX)}
      onMouseLeave={() => setHover(null)}
      onTouchStart={(e) => onMove(e.touches[0].clientX)}
      onTouchMove={(e) => onMove(e.touches[0].clientX)}
      onTouchEnd={() => setHover(null)}
    >
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
          {!hidden && (
            <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--muted-foreground)">
              {t === 0 ? '0' : formatCompact(t)}
            </text>
          )}
        </g>
      ))}
      {xTicks.map((d) => (
        <text key={d} x={x(d)} y={H - 12} textAnchor="middle" fontSize={11} fill="var(--muted-foreground)">
          {d}
        </text>
      ))}

      <path d={planPath} fill="none" stroke="var(--muted-foreground)" strokeOpacity={0.7} strokeWidth={2} strokeDasharray="6 5" strokeLinejoin="round" />
      {area && <polygon points={area} fill="var(--brand-emerald)" fillOpacity={0.12} />}
      {line && <polyline points={line} fill="none" stroke="var(--brand-emerald)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />}

      {todayDay != null && (
        <line x1={x(todayDay)} x2={x(todayDay)} y1={T} y2={y(0)} stroke="var(--foreground)" strokeOpacity={0.25} strokeDasharray="3 4" />
      )}
      {points.length > 0 && (
        <circle cx={points[points.length - 1][0]} cy={points[points.length - 1][1]} r={5} fill="var(--brand-emerald)" stroke="var(--card)" strokeWidth={2} />
      )}

      {tip && (
        <g pointerEvents="none">
          <line x1={x(tip.day)} x2={x(tip.day)} y1={T} y2={y(0)} stroke="var(--foreground)" strokeOpacity={0.35} />
          {tip.actual != null && <circle cx={x(tip.day)} cy={y(tip.actual)} r={5} fill="var(--brand-emerald)" stroke="var(--card)" strokeWidth={2} />}
          <circle cx={x(tip.day)} cy={y(tip.plan)} r={4} fill="var(--card)" stroke="var(--muted-foreground)" strokeWidth={2} />
          <rect x={tipX} y={T + 4} width={180} height={58} rx={8} fill="var(--popover)" stroke="var(--border)" />
          <text x={tipX + 10} y={T + 22} fontSize={12} fontWeight={600} fill="var(--foreground)">
            Tanggal {tip.day}
          </text>
          <text x={tipX + 10} y={T + 38} fontSize={12} fill="var(--foreground)">
            Realisasi: {tip.actual == null ? '—' : money(tip.actual)}
          </text>
          <text x={tipX + 10} y={T + 54} fontSize={12} fill="var(--muted-foreground)">
            Rencana: {money(tip.plan)}
          </text>
        </g>
      )}
    </svg>
  )
}
