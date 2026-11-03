# Finance Tracker

Web app pencatatan keuangan rumah tangga, berdasarkan konsep template spreadsheet "Beruang Budgeting Sheet". Spesifikasi lengkapnya ada di [PRD.md](PRD.md).

**Stack:** React + Vite + TypeScript, Tailwind + shadcn/ui (Base UI), TanStack Query, Recharts, dan Supabase (Postgres, Auth, RLS).

```
Finance_Tracking/
├── PRD.md
├── supabase/migrations/   ← skema database + RLS + views
└── web/                   ← frontend React
```

## Setup

### 1. Supabase
1. Buat project baru di [supabase.com](https://supabase.com).
2. Buka **SQL Editor**, lalu jalankan **berurutan** semua file di `supabase/migrations/`:
   1. `20261103000000_init.sql`: skema dasar
   2. `20261103010000_household.sql`: data bersama per rumah tangga
   3. `20261103020000_sso_allowlist.sql`: hanya email yang diundang yang bisa masuk

   Kalau pakai Supabase CLI: `supabase link` lalu `supabase db push`.
3. **Login Google (SSO):**
   1. Di [Google Cloud Console](https://console.cloud.google.com/), buka **APIs & Services**:
      - Atur **OAuth consent screen** (External).
      - Buat **Credentials → OAuth client ID → Web application** dengan:
        - Authorized JavaScript origins: `http://localhost:5173`
        - Authorized redirect URIs: `https://<project-ref>.supabase.co/auth/v1/callback`
   2. Di Supabase, buka **Authentication → Sign In / Providers → Google**: aktifkan, lalu isi Client ID dan Client Secret.
   3. Biarkan **Allow new users to sign up** tetap aktif. Akses dikunci di database: email yang tidak diundang langsung ditolak.
   4. Opsional: matikan provider **Email** supaya login hanya lewat Google.
4. Buka **Authentication → URL Configuration**:
   - Site URL: `http://localhost:5173`
   - Redirect URLs: tambahkan `http://localhost:5173/**`

### Akun & anggota rumah tangga
Login hanya lewat **Masuk dengan Google**. Tidak ada halaman daftar.

1. **Admin:** orang pertama yang login menjadi admin rumah tangga.
2. Admin membuka **Pengaturan → Anggota rumah tangga** dan **mengundang email Google istri**.
3. Istri cukup klik **Masuk dengan Google** memakai email itu, lalu otomatis bergabung.

Akun Google yang tidak diundang akan ditolak saat login.

### 2. Frontend
```bash
cd web
cp .env.example .env.local     # isi VITE_SUPABASE_URL & VITE_SUPABASE_ANON_KEY
npm install
npm run dev                    # http://localhost:5173
```
Nilai `URL` dan `anon key` ada di Supabase Dashboard → Project Settings → API. **Jangan** pakai `service_role` key di frontend.

### Perintah lain
| Perintah | Fungsi |
|---|---|
| `npm run build` | Type-check + build produksi ke `web/dist` |
| `npm test` | Unit test rumus keuangan (paritas dengan Excel, hutang, tabungan, kalender) |
| `npm run lint` | Lint dengan oxlint |

## Fitur

| Halaman | Pengganti sheet Excel | Isi |
|---|---|---|
| Dashboard | JAN–DES | Gambaran umum rencana vs realisasi, saldo berlanjut, progres per kategori, jatuh tempo, transaksi terakhir |
| Transaksi | BUDGET TRACKING | Catat, edit, dan hapus transaksi; filter kategori; pencarian; export CSV |
| Budget | LIST PENGELUARAN & INPUT DATA | Item rutin bulanan/tahunan per kategori dan tanggal jatuh tempo |
| Hutang | RINCIAN HUTANG | Sisa hutang otomatis, estimasi lunas, rasio cicilan, simulasi Avalanche vs Snowball |
| Tabungan | DASHBOARD TABUNGAN | Target, progres, dan estimasi tercapai |
| Kalender | KALENDAR & PEMBAYARAN | Jadwal jatuh tempo dengan status Lunas / Belum / Telat |
| Tahunan | EVALUASI TAHUNAN | Chart & tabel 12 bulan, goal tahunan |
| Pengaturan | — | Profil, anggota rumah tangga & undangan, tema terang/gelap, backup JSON |

## Catatan desain data
- **Rumus sisa saldo** sama dengan Excel: `Saldo Berlanjut + Pendapatan − Ditabung − (Tagihan + Rumah Tangga) − Hutang`.
- **Edit budget tidak mengubah bulan lalu.** Item yang sudah berlaku sejak bulan lalu disimpan sebagai versi baru (`effective_from` / `effective_to`).
- **Item tahunan** hanya masuk rencana di bulan jatuh temponya, dan di halaman Budget ditampilkan juga "sisihkan Rp X/bulan".
- **Data bersama per rumah tangga:** semua tabel punya `household_id`, sedangkan `user_id` menyimpan siapa yang mencatat.
- **Keamanan:** RLS `household_id = my_household_id()` di semua tabel, view memakai `security_invoker`, dan foreign key komposit `(id, household_id)` supaya data tidak bisa ditautkan lintas rumah tangga.
