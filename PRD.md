# PRD — Finance Tracker Web App

| | |
|---|---|
| **Versi** | 0.1 (draft) |
| **Tanggal** | 3 November 2026 |
| **Owner** | Andreas Rolando |
| **Stack** | React + Vite (frontend), Supabase (database, auth, backend) |
| **Referensi konsep** | `Salinan dari Template Kosong_ BUDGETING SHEET BERUANG.xlsx` |

---

## 1. Latar Belakang

Saat ini keuangan rumah tangga dicatat di template spreadsheet "Beruang Budgeting Sheet" (Google Sheets). Konsepnya bagus: semua pemasukan dan pengeluaran dibagi ke 5 kategori, lalu **rencana (budget)** dibandingkan dengan **realisasi (transaksi aktual)** tiap bulan. Tapi ada beberapa kendala:

- Rumus rusak kalau file di-download ke Excel (`FILTER`, `QUERY`, dan `#REF!` di sheet bulanan).
- Ribet diisi dari HP. Mencatat transaksi harian di spreadsheet tidak praktis.
- Ada 12 sheet bulanan terpisah yang strukturnya sama, jadi sulit dirawat.
- Progres hutang tidak terhitung otomatis. Sisa hutang, bunga, dan estimasi lunas harus diisi manual.

**Solusinya:** web app dengan konsep yang sama, tampilan bersih, nyaman dipakai di HP maupun desktop, dan datanya tersimpan aman di cloud (Supabase).

## 2. Tujuan & Non-Tujuan

### Tujuan
1. Bisa menyusun **rencana budget bulanan** per kategori dan per item.
2. Bisa **mencatat transaksi harian** dengan cepat (di bawah 10 detik per transaksi).
3. Bisa melihat **rencana vs realisasi** dan **sisa saldo** untuk tiap bulan secara otomatis.
4. Bisa **memantau hutang**: sisa pokok, cicilan, jatuh tempo, dan estimasi tanggal lunas.
5. Bisa **memantau tabungan** terhadap target.
6. Bisa melihat **jadwal jatuh tempo** tagihan dan cicilan dalam kalender, lengkap dengan status sudah atau belum dibayar.
7. Ada **evaluasi tahunan** berupa ringkasan 12 bulan.

### Non-Tujuan (di luar scope v1)
- Sinkronisasi otomatis dengan rekening bank atau e-wallet.
- Multi-currency. v1 hanya IDR.
- Fitur investasi lanjutan seperti harga saham atau reksa dana real-time.
- Aplikasi native Android/iOS. v1 berupa web responsif, PWA masuk P2.

## 3. Pengguna

- **Pengguna:** suami & istri dalam satu **rumah tangga (household)**. Keduanya melihat dan mencatat ke data yang sama.
- **Akses tertutup:** tidak ada pendaftaran publik. Admin membuat akun lewat Supabase Dashboard, dan anggota baru bergabung lewat undangan email.

## 4. Konsep Inti (diambil dari Excel)

### 4.1 Lima Kategori Utama
| Kode | Nama | Contoh |
|---|---|---|
| `income` | Pendapatan | Gaji, bonus, usaha sampingan |
| `savings` | Tabungan & Investasi | Arisan, dana darurat, reksa dana |
| `bills` | Tagihan | Kontrakan, listrik, wifi, paket data |
| `household` | Biaya Operasional Rumah Tangga | Belanja mingguan, gas, bensin, jajan |
| `debt` | Hutang | Cicilan pinjol, kartu kredit, KPR/KTA |

Kategori utama bersifat **tetap** (enum). Di dalam setiap kategori, user membuat **item** sendiri yang berfungsi sebagai sub-kategori.

### 4.2 Rencana vs Realisasi
- **Rencana** = jumlah seluruh *budget item* yang aktif pada bulan tersebut.
- **Realisasi** = jumlah seluruh *transaksi* pada bulan tersebut, dikelompokkan per kategori dan per item.

### 4.3 Rumus Ringkasan Bulanan ("Gambaran Umum")
```
Sisa Saldo = Saldo Berlanjut (opsional)
           + Pendapatan
           − Pendapatan Ditabung        (kategori savings)
           − Pendapatan Dibelanjakan    (kategori bills + household)
           − Hutang Dilunasi            (kategori debt)
```
- Rumus ini dihitung dua kali: sekali untuk **Rencana**, sekali untuk **Realisasi**.
- **Saldo Berlanjut** bisa dinyalakan atau dimatikan per bulan (sama seperti checkbox di Excel). Kalau aktif, nilainya diambil dari *Sisa Saldo Realisasi* bulan sebelumnya.
- Kalau Sisa Saldo Rencana bernilai negatif, tampilkan **peringatan defisit** yang jelas.

### 4.4 Frekuensi Budget Item
- **Bulanan**: masuk ke rencana setiap bulan.
- **Tahunan**: masuk ke rencana hanya di bulan jatuh temponya (`due_month`). Selain itu, tampilkan juga info "perlu disisihkan Rp X/bulan", yaitu amount ÷ 12.

> Catatan: di Excel, nilai tahunan dihitung `Jumlah × 12` yang artinya kurang jelas. Di web, semantiknya dibuat eksplisit seperti di atas.

## 5. Fitur

Prioritas: **P0** = MVP wajib, **P1** = setelah MVP, **P2** = nice to have.

### 5.1 Autentikasi (P0)
- Daftar dan login lewat **Supabase Auth**: email + password, plus Google OAuth (P1).
- Lupa password lewat email reset.
- Setiap data terikat ke `user_id` dan dilindungi Row Level Security (RLS).

### 5.2 Dashboard (P0)
*Pengganti tampilan ringkasan bulanan di Excel.*
- Pemilih bulan dan tahun, default bulan berjalan.
- Kartu ringkasan: Pendapatan, Ditabung, Dibelanjakan, Hutang Dibayar, **Sisa Saldo**, masing-masing dengan angka rencana vs realisasi dan progress bar.
- Chart: rencana vs realisasi per kategori (bar), komposisi pengeluaran (donut).
- Daftar **jatuh tempo 7 hari ke depan** yang belum dibayar.
- 5 transaksi terakhir.
- Tombol **+ Transaksi** yang selalu terlihat (FAB di mobile).

### 5.3 Budget / Rencana (P0)
*Pengganti sheet "LIST PENGELUARAN DAN PEMASUKAN" dan "INPUT DATA".*
- CRUD budget item: nama, kategori, jumlah, frekuensi (Bulanan/Tahunan), tanggal jatuh tempo (1–31, opsional), bulan jatuh tempo (khusus tahunan), status aktif/nonaktif.
- Tampilan dikelompokkan per kategori, dengan subtotal per kategori dan **selisih pendapatan vs pengeluaran**.
- Item kategori `debt` terhubung ke data Hutang (5.5). Item kategori `savings` terhubung ke Target Tabungan (5.6).
- Mengubah budget hanya berlaku untuk bulan ini dan seterusnya. Bulan yang sudah lewat tidak ikut berubah (lihat 7.3, *snapshot*).

### 5.4 Transaksi (P0)
*Pengganti sheet "BUDGET TRACKING".*
- Field: tanggal, nominal, kategori, item (sub-kategori, diambil dari budget item kategori tersebut, boleh kosong), keterangan.
- Kalau kategori = Hutang, pilih hutang yang dibayar. Kalau kategori = Tabungan, pilih target tabungannya.
- Form cepat: nominal → kategori → item → simpan. Tanggal default hari ini.
- List transaksi dengan filter (bulan, kategori, item), pencarian keterangan, edit, dan hapus.
- Input nominal dengan format ribuan otomatis (`1.500.000`).

### 5.5 Hutang (P0)
*Pengganti tabel "RINCIAN HUTANG".*
- CRUD hutang: nama/pemberi pinjaman, total pokok awal, cicilan per bulan, bunga per bulan (%), tanggal jatuh tempo, tanggal mulai, tenor (opsional).
- **Sisa hutang** = total awal − total transaksi pembayaran yang terhubung ke hutang tersebut.
- Progress bar pelunasan, jumlah pembayaran yang sudah dilakukan, dan estimasi bulan lunas.
- Ringkasan: total sisa hutang, total cicilan per bulan, serta **rasio cicilan terhadap pendapatan** (peringatan kalau > 30%).
- **(P1) Simulasi strategi pelunasan**: Avalanche (bunga tertinggi dulu) vs Snowball (saldo terkecil dulu), dengan input "pembayaran tambahan per bulan". Hasilnya berupa estimasi tanggal bebas hutang dan total bunga.
- Hutang yang sudah lunas otomatis ditandai **Lunas** dan bisa diarsipkan.

### 5.6 Target Tabungan (P0)
*Pengganti sheet "DASHBOARD TABUNGAN".*
- CRUD target: nama, target nominal, saldo awal, setoran bulanan rencana, tanggal target (opsional).
- **Total terkumpul** = saldo awal + total transaksi tabungan yang terhubung ke target tersebut.
- Progress (%) dan estimasi kapan target tercapai.

### 5.7 Kalender Jatuh Tempo (P1)
*Pengganti sheet "KALENDAR" dan "PEMBAYARAN".*
- Tampilan kalender bulanan yang menampilkan tagihan dan cicilan pada tanggal jatuh temponya.
- Status per item per bulan: **Lunas** (ada transaksi terhubung di bulan itu), **Belum** (belum jatuh tempo), **Telat** (lewat jatuh tempo dan belum dibayar).
- Klik item → "Tandai sudah bayar", lalu muncul form transaksi yang sudah terisi.

### 5.8 Evaluasi Tahunan (P1)
*Pengganti sheet "EVALUASI TAHUNAN".*
- Tabel 12 bulan × 5 kategori (rencana vs realisasi), lengkap dengan total tahunan.
- Chart tren bulanan: pendapatan vs pengeluaran, dan sisa saldo per bulan.
- **Goals tahunan**: daftar tujuan keuangan berupa teks yang bisa dicentang (contoh: "Lunasi kartu kredit").

### 5.9 Pengaturan (P0 dasar, P1 lanjutan)
- Profil (nama), tampilan terang/gelap/ikut sistem.
- (P1) Export transaksi ke CSV, serta export/import semua data ke JSON sebagai backup.
- (P2) Tanggal mulai periode bulanan custom, misalnya mulai tanggal 25 mengikuti tanggal gajian.

## 6. UI / UX

### Prinsip
- **Clean & minimal**: banyak ruang kosong, tipografi jelas, warna dipakai seperlunya. Merah/hijau hanya untuk status (defisit/surplus, telat/lunas).
- **Mobile-first**, tetap nyaman di desktop.
- Bahasa UI: **Bahasa Indonesia**.
- Format angka `Rp 1.500.000`, tanggal `3 Nov 2026`.
- Empty state yang membantu. User mulai dengan data kosong, jadi tiap halaman kosong menampilkan ajakan seperti "Tambah budget pertama kamu".
- **Onboarding singkat** saat pertama login: (1) tambah pendapatan → (2) tambah tagihan & biaya rumah tangga → (3) tambah hutang → (4) tambah target tabungan. Setiap langkah boleh di-skip.

### Navigasi
| Desktop (sidebar) / Mobile (bottom nav + menu) |
|---|
| Dashboard · Transaksi · Budget · Hutang · Tabungan · Kalender · Tahunan · Pengaturan |

Di mobile, bottom nav berisi: **Dashboard, Transaksi, (+), Hutang, Menu**.

## 7. Arsitektur Teknis

### 7.1 Frontend
| Kebutuhan | Pilihan |
|---|---|
| Framework | React 18 + Vite + TypeScript |
| Styling & komponen | Tailwind CSS + shadcn/ui (Radix) |
| Routing | React Router |
| Data fetching / cache | TanStack Query |
| Form & validasi | React Hook Form + Zod |
| Chart | Recharts |
| Tanggal | date-fns (locale `id`) |
| Supabase client | `@supabase/supabase-js` |

### 7.2 Backend
Tidak perlu server terpisah. **Supabase berperan sebagai backend**:
- **Postgres + RLS** untuk semua data. Setiap tabel punya policy `user_id = auth.uid()`.
- **SQL Views / RPC functions** untuk agregasi (ringkasan bulanan, sisa hutang, progres tabungan), supaya perhitungan konsisten dan tidak berat di client.
- **Supabase Auth** untuk login.
- (P2) **Edge Functions + pg_cron** untuk pengingat jatuh tempo via email.
- Migrasi skema dikelola lewat **Supabase CLI** (`supabase/migrations`).

### 7.3 Model Data (draft)

```
profiles          (id = auth.users.id, full_name, theme, created_at)

budget_items      (id, user_id, name, category[enum], amount, frequency['monthly'|'yearly'],
                   due_day, due_month, debt_id?, savings_goal_id?, is_active,
                   effective_from[date], effective_to[date]?, created_at)

debts             (id, user_id, name, principal, monthly_installment, interest_rate_monthly,
                   due_day, start_date, tenor_months?, status['active'|'paid'|'archived'], created_at)

savings_goals     (id, user_id, name, target_amount, initial_amount, monthly_plan,
                   target_date?, created_at)

transactions      (id, user_id, date, amount, category[enum], budget_item_id?, debt_id?,
                   savings_goal_id?, note, created_at)

month_settings    (user_id, year, month, carry_over[bool])          -- PK (user_id, year, month)

annual_goals      (id, user_id, year, title, is_done, created_at)

-- enum category: income | savings | bills | household | debt
```

**Snapshot rencana:** perubahan budget item tidak boleh mengubah rencana bulan lalu. Caranya, simpan `effective_from` / `effective_to`. Saat item diedit, versi lama ditutup (`effective_to`) lalu dibuat versi baru. Rencana sebuah bulan = item yang aktif di rentang tanggal bulan tersebut.

**Views yang direncanakan:**
- `v_monthly_plan` → rencana per user, bulan, kategori, item.
- `v_monthly_actual` → realisasi per user, bulan, kategori, item.
- `v_debt_status` → sisa pokok, total dibayar, progress, estimasi lunas.
- `v_savings_status` → total terkumpul, progress.

### 7.4 Deployment
- Frontend: **Vercel** atau **Netlify** (static build dari Vite).
- Environment: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Service role key **tidak boleh** ada di frontend.

## 8. Kebutuhan Non-Fungsional
- **Keamanan:** RLS aktif di semua tabel, tanpa pengecualian. Tidak ada data user lain yang bisa terbaca.
- **Performa:** halaman utama tampil < 2 detik di koneksi 4G, dan simpan transaksi < 1 detik.
- **Akurasi:** nominal disimpan sebagai `numeric(14,2)` / bigint rupiah, tidak pakai float.
- **Responsif:** lebar 360px (HP) sampai desktop tanpa horizontal scroll.
- **Aksesibilitas:** kontras warna cukup, bisa dinavigasi dengan keyboard (dukungan bawaan shadcn/Radix).

## 9. Rencana Rilis

| Fase | Isi | Estimasi |
|---|---|---|
| **M0 — Setup** | Scaffold Vite + Tailwind + shadcn, project Supabase, skema + RLS + migrasi, auth | 1–2 hari |
| **M1 — MVP (P0)** | Budget, Transaksi, Hutang, Tabungan, Dashboard bulanan, onboarding | 1–2 minggu |
| **M2 — P1** | Kalender jatuh tempo, Evaluasi Tahunan, simulasi pelunasan hutang, export/import, Google login | 1 minggu |
| **M3 — P2** | PWA (install ke HP), pengingat email, periode custom, household sharing | menyusul |

## 10. Kriteria Sukses MVP
- Semua sheet utama di Excel punya padanan yang berfungsi di web.
- Untuk data yang sama, angka Sisa Saldo Rencana di web **sama** dengan hasil rumus Excel.
- Mencatat satu transaksi dari HP bisa selesai dalam ≤ 3 tap + input nominal.
- Sisa hutang dan progres tabungan ter-update otomatis tanpa input manual.

## 11. Open Questions
1. ~~**Household sharing**~~ → **Diputuskan (3 Nov 2026):** data bersama suami & istri dalam satu household, signup publik dimatikan, akun dibuat admin dan anggota diundang via email.
2. **Login:** cukup email + password, atau Google login wajib dari awal?
3. **Periode bulan:** pakai bulan kalender (tanggal 1–akhir bulan), atau mengikuti tanggal gajian?
4. **Bunga hutang:** cukup dicatat untuk informasi dan simulasi, atau perlu dihitung menambah sisa pokok tiap bulan? Saran: cukup informasi, karena cicilan pinjol/CC biasanya sudah termasuk bunga.
5. **Hosting frontend:** Vercel, Netlify, atau server sendiri?
