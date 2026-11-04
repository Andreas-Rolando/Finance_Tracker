import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { BellIcon, CheckCircle2Icon, ExternalLinkIcon, SendIcon, UsersIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Field, MoneyInput } from '@/components/app/fields'
import { memberName, useHousehold, useHouseholdMutations, useTelegram, useTelegramMutations } from '@/hooks/api'
import { formatDate } from '@/lib/dates'
import { formatIDR } from '@/lib/format'
import { cn } from '@/lib/utils'

const BOT = (import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string | undefined)?.replace(/^@/, '')

type Pending = { kind: 'account' | 'group'; code: string; expiresAt: number } | null

export function TelegramCard({ currentUserId }: { currentUserId: string | undefined }) {
  const household = useHousehold().data
  const [requested, setPending] = useState<Pending>(null)
  const [polling, setPolling] = useState(false)
  const telegram = useTelegram({ poll: polling })
  const { createCode, unlinkAccount, unlinkGroup } = useTelegramMutations()

  const accounts = telegram.data?.accounts ?? []
  const group = telegram.data?.group ?? null
  const mine = accounts.find((a) => a.user_id === currentUserId)
  const others = accounts.filter((a) => a.user_id !== currentUserId)

  // Kode otomatis disembunyikan begitu bot mengonfirmasi koneksi (data ter-poll).
  const done = requested && ((requested.kind === 'account' && mine) || (requested.kind === 'group' && group))
  const pending = done ? null : requested
  if (polling !== (pending != null)) setPolling(pending != null)
  const now = useNow(pending != null)

  const expired = pending ? now >= pending.expiresAt : false

  async function start(kind: 'account' | 'group') {
    try {
      const r = await createCode.mutateAsync(kind)
      setPending({ kind, code: r.code, expiresAt: new Date(r.expires_at).getTime() })
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  if (!BOT) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SendIcon className="size-4" /> Telegram
          </CardTitle>
          <CardDescription>
            Isi <code className="rounded bg-muted px-1">VITE_TELEGRAM_BOT_USERNAME</code> di environment (lokal &
            Vercel) dengan username bot kamu, lalu build ulang.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const link = pending && (pending.kind === 'account'
    ? `https://t.me/${BOT}?start=${pending.code}`
    : `https://t.me/${BOT}?startgroup=${pending.code}`)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SendIcon className="size-4" /> Telegram
        </CardTitle>
        <CardDescription>
          Catat transaksi lewat chat ke <span className="font-medium text-foreground">@{BOT}</span>, misalnya{' '}
          <code className="rounded bg-muted px-1">bensin 50rb</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {/* Akun pribadi */}
        <section className="grid gap-2">
          <h3 className="text-sm font-medium">Akun Telegram kamu</h3>
          {mine ? (
            <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm">
              <CheckCircle2Icon className="size-4 shrink-0 text-positive" />
              <span className="min-w-0 flex-1">
                Terhubung{mine.username ? <> sebagai <b>@{mine.username}</b></> : mine.first_name ? <> sebagai <b>{mine.first_name}</b></> : null}
                <span className="block text-xs text-muted-foreground">sejak {formatDate(mine.linked_at.slice(0, 10))}</span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={unlinkAccount.isPending}
                onClick={() => unlinkAccount.mutate(mine.user_id, { onSuccess: () => toast.success('Akun Telegram diputus') })}
              >
                Putuskan
              </Button>
            </div>
          ) : (
            <Button variant="outline" className="justify-self-start" disabled={createCode.isPending} onClick={() => start('account')}>
              Hubungkan akun
            </Button>
          )}
          {others.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Juga terhubung: {others.map((a) => memberName(household, a.user_id) ?? a.first_name ?? 'Anggota').join(', ')}
            </p>
          )}
        </section>

        {/* Grup keluarga */}
        <section className="grid gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-medium">
            <UsersIcon className="size-4" /> Grup keluarga
          </h3>
          {group ? (
            <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm">
              <CheckCircle2Icon className="size-4 shrink-0 text-positive" />
              <span className="min-w-0 flex-1">
                <b>{group.title || 'Grup'}</b> terhubung
                <span className="block text-xs text-muted-foreground">
                  Pengingat & notifikasi pengeluaran besar dikirim ke grup ini.
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={unlinkGroup.isPending}
                onClick={() => unlinkGroup.mutate(group.chat_id, { onSuccess: () => toast.success('Grup diputus') })}
              >
                Putuskan
              </Button>
            </div>
          ) : (
            <>
              <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
                <li>
                  Di <b>@BotFather</b>: kirim <code>/setprivacy</code> → pilih @{BOT} → <b>Disable</b>, supaya bot bisa
                  membaca pesan di grup.
                </li>
                <li>Klik tombol di bawah, lalu pilih grup keluarga (sebaiknya grup khusus keuangan).</li>
              </ol>
              <Button variant="outline" className="justify-self-start" disabled={createCode.isPending} onClick={() => start('group')}>
                Hubungkan grup
              </Button>
            </>
          )}
        </section>

        {pending && link && (
          <div className="grid gap-2 rounded-lg border border-dashed bg-muted/40 p-3 text-sm">
            {expired ? (
              <p className="text-negative">Kode kedaluwarsa. Buat kode baru.</p>
            ) : (
              <>
                <p>
                  {pending.kind === 'account'
                    ? 'Buka bot di Telegram lalu tekan Start.'
                    : 'Pilih grup keluarga di Telegram. Bot akan ditambahkan dan grup otomatis terhubung.'}{' '}
                  Halaman ini akan ter-update sendiri.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <a href={link} target="_blank" rel="noreferrer" className={buttonVariants({ size: 'sm' })}>
                    <ExternalLinkIcon /> {pending.kind === 'account' ? 'Buka Telegram' : 'Tambahkan ke grup'}
                  </a>
                  <span className="text-xs text-muted-foreground tabular">
                    atau kirim <code className="rounded bg-background px-1">{pending.kind === 'account' ? '/start' : '/hubungkan'} {pending.code}</code>
                    {' · '}berlaku {Math.max(0, Math.ceil((pending.expiresAt - now) / 60000))} menit
                  </span>
                </div>
              </>
            )}
            <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setPending(null)}>
              Tutup
            </Button>
          </div>
        )}

        {household && <NotifySettings householdId={household.id} threshold={household.notify_threshold} reminders={household.reminders_enabled} hasGroup={Boolean(group)} />}
      </CardContent>
    </Card>
  )
}

function NotifySettings({
  householdId,
  threshold,
  reminders,
  hasGroup,
}: {
  householdId: string
  threshold: number
  reminders: boolean
  hasGroup: boolean
}) {
  const { updateSettings } = useHouseholdMutations()
  const [value, setValue] = useState<number | null>(threshold)
  const dirty = (value ?? 0) !== threshold

  return (
    <section className="grid gap-3 border-t pt-4">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <BellIcon className="size-4" /> Notifikasi
      </h3>
      <label className="flex items-start gap-3 text-sm">
        <Switch
          checked={reminders}
          disabled={updateSettings.isPending}
          onCheckedChange={(checked) =>
            updateSettings.mutate(
              { id: householdId, reminders_enabled: checked },
              { onSuccess: () => toast.success(checked ? 'Pengingat aktif' : 'Pengingat dimatikan') },
            )
          }
        />
        <span>
          Pengingat jatuh tempo setiap hari jam 07.00 WIB
          <span className="block text-xs text-muted-foreground">
            Dikirim ke {hasGroup ? 'grup keluarga' : 'chat pribadi tiap anggota yang terhubung'}.
          </span>
        </span>
      </label>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          updateSettings.mutate(
            { id: householdId, notify_threshold: value ?? 0 },
            { onSuccess: () => toast.success('Ambang notifikasi disimpan') },
          )
        }}
      >
        <Field
          label="Umumkan pengeluaran besar ke grup mulai dari"
          htmlFor="notify-threshold"
          hint={
            (value ?? 0) === 0
              ? 'Isi 0 untuk mematikan notifikasi.'
              : `Pengeluaran ≥ ${formatIDR(value ?? 0)} yang dicatat dari web atau chat pribadi akan diumumkan ke grup.`
          }
          className="min-w-56 flex-1"
        >
          <MoneyInput id="notify-threshold" value={value} onChange={setValue} />
        </Field>
        <Button type="submit" variant="outline" disabled={!dirty || updateSettings.isPending} className={cn(!hasGroup && 'opacity-80')}>
          Simpan
        </Button>
      </form>
      {!hasGroup && <Badge variant="outline" className="justify-self-start">Butuh grup terhubung</Badge>}
    </section>
  )
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [active])
  return now
}
