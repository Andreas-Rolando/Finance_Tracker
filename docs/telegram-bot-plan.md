# Plan: Input Transaksi via Telegram Bot

| | |
|---|---|
| **Status** | Fase 1–3 sudah diimplementasikan. Setup: [telegram-setup.md](telegram-setup.md) |
| **Tanggal** | 3 November 2026 |
| **Terkait** | [PRD.md](../PRD.md) |

## 1. Tujuan

Mencatat transaksi cukup dengan mengirim chat ke bot Telegram, tanpa membuka web. Contohnya:

```
bensin 50rb
```
Bot membalas:
```
✅ Tercatat: Bensin — Rp 50.000
   Rumah Tangga · Selasa, 3 Nov · oleh Nando
   [↩️ Batalkan]  [✏️ Ganti kategori]
```

Transaksi langsung masuk ke database yang sama dengan web, sehingga Dashboard, sisa hutang, dan tabungan ikut ter-update.

**Bukan tujuan (v1):** mengedit budget atau hutang dari Telegram, dan multi-bahasa.

## 2. Arsitektur

```
 Telegram ──webhook (HTTPS)──▶ Supabase Edge Function `telegram-webhook`
                                  │  1. verifikasi secret header
                                  │  2. cari akun yang terhubung (telegram_user_id → user & household)
                                  │  3. parse pesan → transaksi
                                  │  4. insert ke Postgres (service role, household_id di-set eksplisit)
                                  ▼
                              Postgres (tabel yang sama dengan web app)
                                  ▲
 Web app (React) ─────────────────┘  Pengaturan → "Hubungkan Telegram"
```

**Kenapa Supabase Edge Function, bukan Vercel function atau server sendiri:**
- Service role key tidak perlu keluar dari Supabase. Key-nya sudah tersedia otomatis di Edge Function, jadi tidak perlu disimpan di Vercel.
- Tidak perlu server yang menyala 24 jam. Telegram memanggil webhook hanya saat ada pesan masuk.
- Gratis dalam batas free tier (500 ribu invocation per bulan), jauh di atas kebutuhan 2 orang.
- Nanti bisa dijadwalkan dengan `pg_cron` untuk pengingat jatuh tempo.

**Konsekuensi:** Edge Function memakai service role sehingga **melewati RLS**. Karena itu fungsi ini wajib selalu mengisi `household_id` dan `user_id` dari akun Telegram yang sudah terhubung, tidak pernah dari isi pesan.

## 3. Menghubungkan akun (linking)

Tujuannya: hanya akun Telegram kamu dan istri yang bisa mencatat ke rumah tangga kamu.

1. Di web, buka **Pengaturan → Telegram → Hubungkan**. App memanggil RPC `create_telegram_link_code()`, yang membuat kode acak 8 karakter, berlaku 10 menit, dan hanya bisa dipakai sekali.
2. App menampilkan tombol **Buka Telegram** yang mengarah ke `https://t.me/<NamaBot>?start=<KODE>`.
3. Telegram mengirim `/start <KODE>` ke bot. Edge function lalu:
   - memvalidasi kode (ada, belum kedaluwarsa, belum dipakai),
   - menyimpan `telegram_accounts (user_id, household_id, telegram_user_id, chat_id)`,
   - menghapus kode.
4. Bot membalas: *"Terhubung sebagai Nando ✅. Kirim transaksi seperti: makan siang 35rb"*.

Akun Telegram yang belum terhubung tidak diproses dan hanya dibalas petunjuk cara menghubungkan. Akun bisa diputus dari web (Pengaturan) atau dari bot dengan `/putus`.

## 4. Format pesan yang dipahami

Satu baris = satu transaksi. Satu pesan boleh berisi beberapa baris.

| Contoh | Hasil |
|---|---|
| `bensin 50rb` | Rumah Tangga · item *Bensin* · Rp 50.000 · hari ini |
| `makan siang 35k` | Rumah Tangga · *Lainnya* · Rp 35.000 · catatan "makan siang" |
| `listrik 412.500` | Tagihan · item *Listrik* (cocok dengan nama item budget) |
| `bayar kartu kredit 1,5jt` | Hutang · *Kartu Kredit* → mengurangi sisa hutang |
| `nabung dana darurat 500rb` | Tabungan · target *Dana darurat* |
| `+gaji 9jt` / `gaji masuk 9jt` | Pendapatan · Rp 9.000.000 |
| `kemarin belanja 120rb` | tanggal = kemarin |
| `5/11 wifi 150rb` | tanggal = 5 Nov |

**Aturan parser (berbasis aturan, tanpa AI):**
1. **Nominal**: `50rb`, `50 ribu`, `50k`, `1,5jt`, `1.5jt`, `2 juta`, `Rp 50.000`, `50000`. Kalau ada beberapa angka, yang dipilih adalah angka yang punya satuan. Kalau tidak ada yang bersatuan, dipilih angka terbesar yang ≥ 1.000.
2. **Tanggal**: `hari ini` (default), `kemarin`, `2 hari lalu`, `tgl 5`, `5/11`. Zona waktu **Asia/Jakarta**.
3. **Pendapatan**: diawali `+`, atau mengandung kata *gaji, terima, masuk, bonus, transferan*.
4. **Kategori & item**, dengan urutan prioritas:
   1. nama **hutang** aktif,
   2. nama **target tabungan**,
   3. nama **item budget** bulan itu (fuzzy, mis. "listrik" cocok dengan "Token Listrik"),
   4. kamus kata kunci (bensin/parkir/makan → Rumah Tangga, pulsa/wifi/pln → Tagihan, dst.).
5. **Tidak yakin** (tidak ada yang cocok): bot **tidak langsung menyimpan**, tapi menampilkan tombol pilihan kategori.

Parser ditulis sebagai fungsi murni di `supabase/functions/_shared/parser.ts` dan diuji dengan unit test (puluhan contoh kalimat asli).

## 5. Perintah bot

| Perintah | Fungsi |
|---|---|
| `/start <kode>` | Hubungkan akun |
| `/bantuan` | Contoh format pesan |
| `/ringkasan` | Gambaran umum bulan ini: pendapatan, pengeluaran, sisa saldo (rencana vs realisasi) |
| `/hariini` | Transaksi hari ini & totalnya |
| `/batal` | Batalkan transaksi terakhir yang kamu catat (maks. 24 jam) |
| `/hutang` | Sisa tiap hutang & estimasi lunas |
| `/jatuhtempo` | Tagihan/cicilan yang belum dibayar bulan ini |
| `/putus` | Putuskan akun Telegram |

Tombol inline di balasan: **↩️ Batalkan**, **✏️ Ganti kategori**, dan pilihan kategori atau item. Karena data callback Telegram dibatasi 64 byte, transaksi yang menunggu konfirmasi disimpan di tabel `telegram_pending`. Callback cukup membawa ID-nya.

## 6. Perubahan database (migrasi 5)

```sql
telegram_accounts (
  user_id          uuid pk → profiles,
  household_id     uuid → households,
  telegram_user_id bigint unique not null,
  chat_id          bigint not null,
  username         text,
  notify_due       boolean default true,
  linked_at        timestamptz default now()
)

telegram_link_codes (code text pk, user_id uuid, expires_at timestamptz)   -- sekali pakai, 10 menit

telegram_pending (
  id uuid pk, telegram_user_id bigint, payload jsonb, created_at timestamptz   -- dibersihkan > 1 hari
)

transactions
  + source text not null default 'app' check (source in ('app', 'telegram'))
```

**Keamanan:**
- RLS aktif. Dari web, user hanya bisa **melihat dan menghapus** link miliknya sendiri. Insert hanya dilakukan Edge Function (service role).
- RPC `create_telegram_link_code()` memakai `security definer`, hanya untuk `authenticated`, dan menghapus kode lama milik user itu.
- Webhook diverifikasi lewat header `X-Telegram-Bot-Api-Secret-Token`, yang diisi saat `setWebhook`. Request tanpa secret yang benar langsung ditolak (401).
- Hanya **chat pribadi** yang diproses. Pesan dari grup diabaikan.
- Pembatasan laju sederhana: maks. ±30 pesan/menit per user.
- Token bot & secret disimpan di **Supabase Secrets**, tidak masuk ke repo.

## 7. Perubahan web app

- **Pengaturan → kartu Telegram**:
  - status (terhubung sebagai @username, atau belum),
  - tombol **Hubungkan** yang menampilkan kode dan tombol *Buka Telegram*,
  - tombol **Putuskan**,
  - toggle **Pengingat jatuh tempo** (untuk fase 3).
- **Daftar transaksi**: ikon kecil Telegram untuk transaksi yang `source = 'telegram'`.
- Tidak ada perubahan pada rumus atau halaman lain.

## 8. Struktur kode

```
supabase/
  functions/
    _shared/
      parser.ts          ← parse kalimat → { amount, date, category, itemId?, debtId?, goalId?, note }
      parser.test.ts
      format.ts          ← format Rupiah & tanggal (sama dengan web)
    telegram-webhook/
      index.ts           ← verifikasi, routing update/command/callback
      telegram.ts        ← helper sendMessage / answerCallbackQuery / editMessage
      handlers/          ← start, transaksi, ringkasan, hutang, batal, ...
  migrations/
    20261104000000_telegram.sql
```

Deploy:
```bash
supabase functions deploy telegram-webhook --no-verify-jwt
supabase secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=...
# daftar webhook sekali:
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d url=https://<ref>.supabase.co/functions/v1/telegram-webhook \
  -d secret_token=<SECRET> -d allowed_updates='["message","callback_query"]'
```
Flag `--no-verify-jwt` diperlukan karena Telegram tidak mengirim JWT Supabase. Sebagai gantinya, keamanan memakai secret header.

## 9. Fase

| Fase | Isi | Estimasi |
|---|---|---|
| **1 — Inti** | Buat bot di @BotFather, migrasi 5, Edge Function, linking akun, parser + test, catat transaksi, tombol Batalkan / Ganti kategori, `/bantuan`, `/batal`, kartu Telegram di Pengaturan | 2–3 hari |
| **2 — Info** | `/ringkasan`, `/hariini`, `/hutang`, `/jatuhtempo`, ikon Telegram di daftar transaksi | 1 hari |
| **3 — Pengingat** | `pg_cron` setiap hari jam 07.00 WIB: pesan "Hari ini jatuh tempo: Wifi Rp 150.000 [Tandai lunas]" + ringkasan mingguan | 1 hari |
| **4 — AI (opsional)** | Parsing kalimat bebas & **foto struk** pakai Claude: "tadi isi bensin 50 ribu sama parkir 5 ribu" → 2 transaksi | 1–2 hari |

## 10. Keputusan (3 Nov 2026)

1. **Simpan langsung** kalau kategorinya yakin, dengan tombol *Batalkan*. Kalau tidak yakin, bot minta pilih kategori dulu.
2. **Parser berbasis aturan.** AI baru ditambahkan nanti (fase 4).
3. **Pengingat jatuh tempo setiap hari jam 07.00 WIB.** Isinya tagihan yang telat, jatuh tempo hari ini, dan jatuh tempo besok, dengan tombol *Bayar*.
4. **Grup keluarga.**
   - Bot ditambahkan ke grup dengan **privacy mode dimatikan** (`/setprivacy` → Disable di @BotFather), supaya bot bisa membaca pesan biasa.
   - Grup dihubungkan ke rumah tangga lewat tautan `t.me/<bot>?startgroup=<KODE>` dari web.
   - Tiap anggota tetap menghubungkan akun Telegram pribadinya sekali, supaya pencatatnya jelas. Pesan dari orang yang belum terhubung diabaikan.
   - Chat pribadi ke bot tetap bisa dipakai.
5. **Notifikasi pengeluaran besar ke grup.** Pengeluaran ≥ ambang (default **Rp 500.000**, bisa diubah di Pengaturan) yang dicatat dari web atau chat pribadi akan diumumkan ke grup, misalnya *"💸 Istri mencatat Belanja Rp 750.000"*.

### Tambahan desain untuk grup & notifikasi
- Tabel `telegram_groups (chat_id, household_id unique, title)`: satu grup per rumah tangga.
- Kolom baru di `households`: `notify_threshold` (default 500.000) dan `reminders_enabled` (default true).
- Kolom baru di `transactions`: `telegram_chat_id`, untuk tahu chat asal transaksi.
- Tabel `telegram_outbox`. Trigger di `transactions` mengantrekan notifikasi pengeluaran besar, lalu `pg_cron` setiap menit memanggil Edge Function `telegram-cron?task=outbox` untuk mengirimnya. Insert transaksi tidak pernah gagal gara-gara Telegram.
- `pg_cron` jam 00.00 UTC (07.00 WIB) memanggil `telegram-cron?task=reminders`.
- URL dan secret untuk cron disimpan di **Supabase Vault**, tidak di repo.

## 11. Yang perlu kamu siapkan

1. Buat bot di Telegram: chat **@BotFather** → `/newbot` → beri nama, misalnya *Nando Finance*, dan username yang berakhiran `bot`. Simpan **token** yang diberikan, dan jangan kirim ke chat.
2. Di @BotFather: `/setprivacy` → pilih bot → **Disable**. Lakukan ini **sebelum** bot dimasukkan ke grup.
3. Install **Supabase CLI** dan login (`npx supabase login`), lalu `supabase link` ke project kamu. Ini dipakai untuk deploy Edge Function.
