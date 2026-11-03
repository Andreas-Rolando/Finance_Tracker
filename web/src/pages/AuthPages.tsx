import { useState } from 'react'
import { WalletIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { supabase } from '@/lib/supabase'

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <div className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
            <WalletIcon className="size-5" />
          </div>
          <span className="text-lg font-semibold tracking-tight">Finance Tracker</span>
        </div>
        {children}
      </div>
    </div>
  )
}

/** Ambil pesan error OAuth dari URL (?error_description=... atau #error_description=...). */
function readOAuthError(): string | null {
  const params = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const desc = params.get('error_description') ?? hash.get('error_description')
  if (!desc) return null
  // Bersihkan URL supaya error tidak muncul lagi saat refresh.
  window.history.replaceState(null, '', window.location.pathname)
  return desc
}

function translateOAuthError(desc: string): string {
  const d = desc.toLowerCase()
  if (d.includes('database error saving new user') || d.includes('belum diundang'))
    return 'Akun Google ini belum punya akses. Minta admin rumah tangga mengundang email kamu di Pengaturan.'
  if (d.includes('signups not allowed') || d.includes('signup is disabled'))
    return 'Pendaftaran akun baru sedang dimatikan di Supabase. Aktifkan "Allow new users to sign up" (akses tetap dikunci lewat undangan).'
  if (d.includes('provider is not enabled')) return 'Login Google belum diaktifkan di Supabase.'
  return desc
}

export function LoginPage() {
  const [error, setError] = useState<string | null>(() => {
    const e = readOAuthError()
    return e ? translateOAuthError(e) : null
  })
  const [busy, setBusy] = useState(false)

  async function signInWithGoogle() {
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin, queryParams: { prompt: 'select_account' } },
    })
    // Kalau sukses, browser langsung diarahkan ke Google — baris di bawah hanya jalan saat gagal.
    if (error) {
      setError(translateOAuthError(error.message))
      setBusy(false)
    }
  }

  return (
    <AuthShell>
      <Card>
        <CardHeader className="text-center">
          <CardTitle>Masuk</CardTitle>
          <CardDescription>Keuangan rumah tangga — khusus anggota yang diundang.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Button size="lg" variant="outline" className="h-10 w-full gap-2.5" onClick={signInWithGoogle} disabled={busy}>
            <GoogleIcon />
            {busy ? 'Mengarahkan ke Google…' : 'Masuk dengan Google'}
          </Button>
          {error && (
            <p role="alert" className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative">
              {error}
            </p>
          )}
          <p className="text-center text-xs text-muted-foreground">
            Belum punya akses? Minta admin rumah tangga mengundang email Google kamu.
          </p>
        </CardContent>
      </Card>
    </AuthShell>
  )
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

export function SetupRequiredPage() {
  return (
    <AuthShell>
      <Card>
        <CardHeader>
          <CardTitle>Hubungkan ke Supabase</CardTitle>
          <CardDescription>Aplikasi belum dikonfigurasi.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Buat project di <span className="font-medium">supabase.com</span>, lalu jalankan SQL di{' '}
              <code className="rounded bg-muted px-1">supabase/migrations/</code> lewat SQL Editor.
            </li>
            <li>
              Copy <code className="rounded bg-muted px-1">web/.env.example</code> menjadi{' '}
              <code className="rounded bg-muted px-1">web/.env.local</code>.
            </li>
            <li>
              Isi <code className="rounded bg-muted px-1">VITE_SUPABASE_URL</code> dan{' '}
              <code className="rounded bg-muted px-1">VITE_SUPABASE_ANON_KEY</code> dari Project Settings → API.
            </li>
            <li>Restart <code className="rounded bg-muted px-1">npm run dev</code>.</li>
          </ol>
        </CardContent>
      </Card>
    </AuthShell>
  )
}
