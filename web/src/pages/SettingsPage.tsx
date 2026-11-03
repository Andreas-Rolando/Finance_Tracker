import { useState } from 'react'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import { DownloadIcon, LogOutIcon, MailIcon, MonitorIcon, MoonIcon, SunIcon, UsersIcon, XIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/app/bits'
import { Field } from '@/components/app/fields'
import { exportAllData, useHousehold, useHouseholdMutations, useProfile, useUpdateProfile } from '@/hooks/api'
import { todayISO } from '@/lib/dates'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { useAuth } from '@/providers/auth'

export function SettingsPage() {
  const { session } = useAuth()
  const userId = session?.user.id
  const profile = useProfile(userId)
  const update = useUpdateProfile()
  const { theme, setTheme } = useTheme()
  const [exporting, setExporting] = useState(false)

  async function download() {
    setExporting(true)
    try {
      const data = await exportAllData()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `finance-backup-${todayISO()}.json`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setExporting(false)
    }
  }

  const themes = [
    { key: 'light', label: 'Terang', icon: SunIcon },
    { key: 'dark', label: 'Gelap', icon: MoonIcon },
    { key: 'system', label: 'Sistem', icon: MonitorIcon },
  ]

  return (
    <>
      <PageHeader title="Pengaturan" />
      <div className="grid max-w-2xl gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Profil</CardTitle>
            <CardDescription>{session?.user.email}</CardDescription>
          </CardHeader>
          <CardContent>
            {profile.isLoading ? null : (
              <ProfileForm
                key={profile.data?.full_name ?? ''}
                initialName={profile.data?.full_name ?? ''}
                pending={update.isPending}
                onSave={(full_name) =>
                  userId &&
                  update.mutate(
                    { id: userId, full_name },
                    { onSuccess: () => toast.success('Profil disimpan'), onError: (err) => toast.error(err.message) },
                  )
                }
              />
            )}
          </CardContent>
        </Card>

        <HouseholdCard currentUserId={userId} />

        <Card>
          <CardHeader>
            <CardTitle>Tampilan</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Tema">
              {themes.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="radio"
                  aria-checked={theme === t.key}
                  onClick={() => setTheme(t.key)}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-lg border py-3 text-sm transition-colors',
                    theme === t.key ? 'border-foreground bg-muted' : 'hover:bg-muted/60',
                  )}
                >
                  <t.icon className="size-4" />
                  {t.label}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Backup data</CardTitle>
            <CardDescription>Unduh semua data (budget, transaksi, hutang, tabungan) dalam format JSON.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={download} disabled={exporting}>
              <DownloadIcon /> {exporting ? 'Menyiapkan…' : 'Export JSON'}
            </Button>
          </CardContent>
        </Card>

        <Button variant="destructive" className="justify-self-start" onClick={() => supabase.auth.signOut()}>
          <LogOutIcon /> Keluar
        </Button>
      </div>
    </>
  )
}

function ProfileForm({
  initialName,
  pending,
  onSave,
}: {
  initialName: string
  pending: boolean
  onSave: (name: string) => void
}) {
  const [name, setName] = useState(initialName)
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        onSave(name.trim())
      }}
    >
      <Field label="Nama" htmlFor="s-name" className="flex-1">
        <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Button type="submit" variant="outline" disabled={pending}>
        Simpan
      </Button>
    </form>
  )
}

function HouseholdCard({ currentUserId }: { currentUserId: string | undefined }) {
  const household = useHousehold()
  const { invite, cancelInvite } = useHouseholdMutations()
  const [email, setEmail] = useState('')
  const h = household.data

  if (household.isLoading) return null
  if (household.error) return <p className="text-sm text-negative">{(household.error as Error).message}</p>
  if (!h) return null

  const memberEmails = new Set(h.members.map((m) => m.profile?.email?.toLowerCase()))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UsersIcon className="size-4" /> Anggota rumah tangga
        </CardTitle>
        <CardDescription>Semua anggota melihat & mencatat ke data keuangan yang sama.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ul className="divide-y rounded-lg border">
          {h.members.map((m) => (
            <li key={m.user_id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
              {m.profile?.avatar_url ? (
                <img
                  src={m.profile.avatar_url}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="size-8 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold uppercase">
                  {(m.profile?.full_name || m.profile?.email || '?').slice(0, 1)}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {m.profile?.full_name || m.profile?.email?.split('@')[0] || 'Anggota'}
                  {m.user_id === currentUserId && <span className="font-normal text-muted-foreground"> (kamu)</span>}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{m.profile?.email}</span>
              </span>
              <Badge variant={m.role === 'owner' ? 'secondary' : 'outline'}>{m.role === 'owner' ? 'Admin' : 'Anggota'}</Badge>
            </li>
          ))}
          {h.invites.map((i) => (
            <li key={i.email} className="flex items-center gap-3 px-3 py-2.5 text-sm">
              <span className="grid size-8 shrink-0 place-items-center rounded-full border border-dashed text-muted-foreground">
                <MailIcon className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{i.email}</span>
                <span className="block text-xs text-muted-foreground">Diundang · belum login</span>
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Batalkan undangan ${i.email}`}
                disabled={cancelInvite.isPending}
                onClick={() => cancelInvite.mutate(i.email, { onSuccess: () => toast.success('Undangan dibatalkan') })}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>

        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const value = email.trim().toLowerCase()
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return toast.error('Email tidak valid')
            if (memberEmails.has(value)) return toast.error('Email ini sudah jadi anggota')
            invite.mutate(
              { householdId: h.id, email: value },
              {
                onSuccess: () => {
                  setEmail('')
                  toast.success('Undangan tersimpan')
                },
                onError: (err) =>
                  toast.error(err.message.includes('duplicate') ? 'Email ini sudah diundang' : err.message),
              },
            )
          }}
        >
          <Field
            label="Undang anggota"
            htmlFor="invite-email"
            hint="Masukkan email Google-nya. Setelah diundang, dia cukup klik “Masuk dengan Google” memakai email itu dan otomatis bergabung ke rumah tangga ini. Email lain tidak bisa masuk."
          >
            <div className="flex gap-2">
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@contoh.com"
                autoComplete="off"
              />
              <Button type="submit" variant="outline" disabled={invite.isPending || !email.trim()}>
                Undang
              </Button>
            </div>
          </Field>
        </form>
      </CardContent>
    </Card>
  )
}
