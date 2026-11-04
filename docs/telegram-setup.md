# Setup Telegram Bot

Panduan sekali jalan untuk mengaktifkan bot, **tanpa CLI**: semuanya lewat Supabase Dashboard dan browser. Desainnya ada di [telegram-bot-plan.md](telegram-bot-plan.md).

Project ref Supabase kamu adalah bagian depan URL project: `https://<project-ref>.supabase.co`.

> **Urutan penting:** jalankan migrasi (langkah 2) **sebelum** push/deploy web terbaru.

## 1. Buat bot di Telegram
1. Chat **@BotFather**, kirim `/newbot`, isi nama (mis. *Nando Finance*) dan username yang berakhiran `bot`.
2. Simpan **token** yang diberikan, bentuknya seperti `123456789:AAH...`. Ini rahasia: jangan dikirim ke chat atau di-commit.
3. Kirim `/setprivacy`, pilih bot kamu, lalu pilih **Disable**.
4. (Opsional) Kirim `/setcommands`, pilih bot, lalu tempel daftar ini:
   ```
   ringkasan - Gambaran keuangan bulan ini
   hariini - Transaksi hari ini
   hutang - Sisa hutang
   jatuhtempo - Tagihan yang belum dibayar
   batal - Batalkan transaksi terakhir
   bantuan - Cara mencatat
   putus - Putuskan bot dari chat ini
   ```

## 2. Migrasi database (SQL Editor)
1. Buka **Database → Extensions**, lalu aktifkan **pg_cron** dan **pg_net**.
2. Di **SQL Editor → New query**, jalankan isi file berikut satu per satu:
   1. `supabase/migrations/20261104000000_telegram.sql`
   2. `supabase/migrations/20261104010000_telegram_cron.sql`

## 3. Buat dua secret acak
Secret ini adalah password antara Telegram/cron dan fungsi kamu. Buat dua yang berbeda, misalnya dengan menjalankan perintah ini dua kali di PowerShell:
```powershell
-join ((1..48) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
```
Kamu juga boleh mengetik sendiri string acak sekitar 40 karakter (huruf dan angka saja). Catat sebagai **secret #1** (webhook) dan **secret #2** (cron).

## 4. Simpan secret di Supabase (UI)
Buka **Edge Functions → Secrets**, lalu tambahkan 4 secret:

| Name | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | token dari BotFather |
| `TELEGRAM_BOT_USERNAME` | username bot **tanpa** `@` |
| `TELEGRAM_WEBHOOK_SECRET` | secret #1 |
| `TELEGRAM_CRON_SECRET` | secret #2 |

`SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` sudah otomatis tersedia, jadi tidak perlu ditambahkan.

## 5. Deploy 2 fungsi (UI)
Kode fungsi sudah digabung jadi satu file per fungsi:
- `supabase/functions-bundled/telegram-webhook.ts`
- `supabase/functions-bundled/telegram-cron.ts`

Kalau folder itu belum ada, generate dulu dengan `node scripts/bundle-functions.mjs` dari root repo.

Untuk **setiap** fungsi:
1. Buka **Edge Functions → Deploy a new function → Via Editor**.
2. **Nama fungsi** harus persis `telegram-webhook` (lalu `telegram-cron` untuk fungsi kedua).
3. Hapus contoh kode di editor, lalu buka file bundled-nya di VS Code, **Ctrl+A → Ctrl+C**, dan tempel di editor dashboard.
4. Klik **Deploy function**.
5. Setelah ter-deploy, buka tab **Settings** fungsi itu, **matikan "Verify JWT with legacy secret"** (toggle jadi abu-abu), lalu **Save changes**. Ini wajib, karena Telegram dan cron tidak mengirim JWT. Keamanannya ditangani secret header.

## 6. Daftarkan webhook (browser)
Susun URL ini, ganti bagian `<...>`, lalu buka di browser:
```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<project-ref>.supabase.co/functions/v1/telegram-webhook&secret_token=<secret #1>&drop_pending_updates=true
```
Kalau berhasil, browser menampilkan `{"ok":true,"result":true,"description":"Webhook was set"}`.

Untuk mengecek statusnya, buka `https://api.telegram.org/bot<TOKEN>/getWebhookInfo`.

## 7. Secret untuk cron (SQL Editor)
Jalankan sekali di **SQL Editor**:
```sql
select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/telegram-cron', 'telegram_cron_url');
select vault.create_secret('<secret #2>', 'telegram_cron_secret');
```

## 8. Web app
Tambahkan variabel ini di `web/.env.local` **dan** di Vercel → Settings → Environment Variables:
```
VITE_TELEGRAM_BOT_USERNAME=<username bot tanpa @>
```
Setelah itu restart `npm run dev`, lalu redeploy Vercel.

## 9. Hubungkan akun & grup

**Prasyarat:** langkah 1–8 sudah selesai, dan web sudah memakai `VITE_TELEGRAM_BOT_USERNAME`. Kalau di kartu Telegram masih muncul tulisan "Isi VITE_TELEGRAM_BOT_USERNAME…", restart `npm run dev` atau redeploy Vercel.

### 9a. Akun Telegram kamu
1. Login ke web dan buka **Pengaturan**, lalu scroll ke kartu **Telegram**.
2. Klik **Hubungkan akun**. Akan muncul kotak berisi tombol **Buka Telegram** dan kode, misalnya `/start 9A1B2C3D4E5F`. Kode ini berlaku **10 menit**.
3. Klik **Buka Telegram**. Aplikasi Telegram terbuka di chat dengan bot kamu.
4. Tekan tombol **START** di bawah chat.
5. Bot membalas **"✅ Terhubung sebagai Nando"** beserta contoh cara mencatat.
6. Kembali ke web. Dalam beberapa detik kartu Telegram berubah menjadi **"Terhubung sebagai @username"** tanpa perlu refresh.

Kalau tombol *Buka Telegram* tidak membuka aplikasi (misalnya di PC tanpa Telegram Desktop), buka chat bot secara manual dan kirim teks `/start KODE` yang tampil di web.

### 9b. Akun Telegram istri
1. Pastikan istri **sudah anggota rumah tangga**, artinya dia sudah diundang di **Pengaturan → Anggota rumah tangga** dan sudah pernah login ke web dengan Google.
2. Istri login ke web dari HP atau laptopnya sendiri, lalu ulangi langkah **9a** dengan akun Telegram-nya.
3. Setelah itu di kartu Telegram kamu akan muncul *"Juga terhubung: [nama istri]"*.

### 9c. Grup keluarga
1. **Buat grupnya dulu** di Telegram: **New Group**, tambahkan istri, lalu beri nama misalnya *Keuangan Keluarga*. Sebaiknya grup khusus keuangan, bukan grup ngobrol sehari-hari.
2. Pastikan **privacy mode bot sudah Disable** (langkah 1.3). Kalau bot sudah terlanjur ada di grup sebelum privacy dimatikan, keluarkan dulu bot dari grup.
3. Di web, buka **Pengaturan → Telegram → Hubungkan grup**, lalu klik **Tambahkan ke grup**.
4. Telegram menampilkan daftar grup. Pilih **Keuangan Keluarga**, lalu konfirmasi **Add bot / Tambahkan**.
5. Bot mengirim pesan di grup: **"✅ Grup Keuangan Keluarga terhubung ke rumah tangga."**
   - Kalau ada peringatan *"Privacy mode bot masih aktif"*, ulangi langkah 2.
6. Di web, kartu Telegram berubah menjadi **"Keuangan Keluarga terhubung"**.

Kalau pemilihan grup tidak muncul, tambahkan bot ke grup secara manual (Add member → cari username bot), lalu kirim `/hubungkan KODE` di grup itu.

### 9d. Coba
1. Di grup, kirim `bensin 50rb`.
2. Bot membalas **"✅ Bensin — Rp 50.000"** beserta tombol **↩️ Batalkan** dan **✏️ Kategori**.
3. Buka web, lalu **Transaksi**. Transaksinya muncul dengan ikon ✈️ (dicatat via Telegram).
4. Coba juga `/ringkasan` dan `/jatuhtempo`.

## Troubleshooting
| Gejala | Cek |
|---|---|
| Bot tidak membalas | Buka `getWebhookInfo` dan lihat `last_error_message`. Cek juga Dashboard → Edge Functions → telegram-webhook → **Logs** |
| `401` di log webhook | `secret_token` di URL setWebhook berbeda dengan `TELEGRAM_WEBHOOK_SECRET`, **atau** "Verify JWT with legacy secret" masih aktif. Lihat Logs: pesan *"secret webhook tidak cocok (diterima X, di Supabase Y karakter)"* menunjukkan beda panjangnya |
| Di grup bot hanya merespons perintah | Privacy mode masih aktif. Matikan, lalu keluarkan dan masukkan lagi bot ke grup |
| Pengingat jam 7 tidak datang | Di SQL Editor, jalankan `select * from cron.job_run_details order by start_time desc limit 5;` dan cek secret Vault (langkah 7) |
| Notifikasi pengeluaran besar tidak datang | Grup harus terhubung, ambang di Pengaturan > 0, dan transaksinya dicatat dari web atau chat pribadi |

---

### Alternatif: deploy lewat CLI (PowerShell)
```powershell
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase secrets set TELEGRAM_BOT_TOKEN=<token> TELEGRAM_BOT_USERNAME=<username> TELEGRAM_WEBHOOK_SECRET=<secret1> TELEGRAM_CRON_SECRET=<secret2>
npx supabase functions deploy telegram-webhook
npx supabase functions deploy telegram-cron
```
Pengaturan `verify_jwt = false` sudah ada di `supabase/config.toml`.
