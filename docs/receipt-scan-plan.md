# Plan: Foto Struk → Transaksi

| | |
|---|---|
| **Status** | ⏸️ Ditunda (4 Nov 2026), belum ada kode. Lanjutkan dengan memilih opsi di bagian 10 |
| **Tanggal** | 4 November 2026 |
| **Terkait** | [telegram-bot-plan.md](telegram-bot-plan.md) (fase 4) |

## 1. Tujuan

Kirim foto struk atau bill ke bot Telegram, lalu bot membaca **toko, tanggal, total, dan daftar item**. Hasilnya ditampilkan untuk dikonfirmasi, dan setelah dikonfirmasi tercatat sebagai pengeluaran.

```
[foto struk Indomaret]                     ← kamu kirim (boleh + caption, mis. "belanja bulanan")

🧾 Indomaret Cempaka Putih — Rp 125.400    ← bot membalas ±5–15 detik kemudian
🛒 Rumah Tangga · item Belanja Mingguan · Senin, 3 Nov
   • Beras 5kg ............ Rp 72.500
   • Minyak goreng 2L ..... Rp 38.900
   • (+3 item lain)
[✅ Simpan]  [✏️ Kategori]  [❌ Batal]
```

Bisa dipakai di chat pribadi maupun grup keluarga. Selain foto, bot juga menerima **PDF e-receipt** (Shopee, Tokopedia, Grab, tagihan PLN) yang dikirim sebagai file.

**Bukan tujuan (v1):** memecah satu struk menjadi beberapa kategori, kurs mata uang asing, dan upload dari web. Upload dari web direncanakan di fase 2.

## 2. Alur

```
Telegram (foto/PDF + caption?)
   │
   ▼
telegram-webhook ─┬─ balas cepat "⏳ Membaca struk…" lalu kembalikan 200 ke Telegram
                  │   (proses lanjut di background: EdgeRuntime.waitUntil → tidak kena timeout/retry)
                  ▼
   1. getFile → unduh gambar dari Telegram (maks. 10 MB)
   2. simpan ke Supabase Storage  receipts/<household_id>/<uuid>.jpg   (kalau opsi simpan foto dipilih)
   3. Claude API (vision + structured output) ← daftar item budget/hutang/tabungan rumah tangga
   4. hasil → telegram_pending → edit pesan "⏳" menjadi pratinjau + tombol
   │
   ▼
[✅ Simpan] → insert transaksi (source=telegram, receipt_path) → "✅ Tercatat"
```

## 3. Ekstraksi dengan Claude

- **Model:** `claude-opus-5-5` (default, paling akurat untuk struk kusut, miring, atau buram). Alternatifnya `claude-haiku-5-5`, jauh lebih murah (lihat bagian 9).
- **Effort `low`.** Membaca struk tugas yang sederhana, dan effort rendah membuat respons lebih cepat dan hemat.
- **Structured output** (`output_config.format` JSON schema) supaya hasilnya selalu JSON yang valid:
  ```jsonc
  {
    "is_receipt": true,
    "merchant": "Indomaret Cempaka Putih",
    "date": "2026-11-03",          // null kalau tidak terbaca → pakai hari ini
    "total": 125400,               // total yang DIBAYAR (setelah diskon/pajak), rupiah bulat
    "items": [{ "name": "Beras 5kg", "qty": 1, "amount": 72500 }],
    "category": "household",       // income|savings|bills|household|debt
    "budget_item_id": "…" | null,  // dipilih dari daftar item rumah tangga yang dikirim di prompt
    "debt_id": null, "goal_id": null,
    "confidence": "high" | "low",
    "note": "Belanja bulanan"      // dari caption kalau ada
  }
  ```
- **Konteks yang dikirim:** nama item budget, hutang, dan target tabungan rumah tangga, supaya Claude bisa memilih item yang tepat. Contohnya, struk PLN → item *Token Listrik*, dan struk Pertamina → item *Bensin*.
- **Caption menang.** Kalau caption berisi petunjuk, misalnya `bensin` atau `kantor`, petunjuk itu dipakai untuk kategori dan catatan.
- **Refusal fallback** (`fallbacks: "default"`) aktif sesuai rekomendasi untuk Opus 5.5.
- **Bukan struk** (foto selfie, meme): bot membalas *"Ini sepertinya bukan struk 🤔"* dan tidak menyimpan apa pun.

## 4. Konfirmasi & tombol

| Tombol | Aksi |
|---|---|
| ✅ Simpan | Simpan transaksi dengan total & kategori hasil baca |
| ✏️ Kategori | Pilih kategori lain (pakai tombol yang sama seperti input teks) |
| 🔢 Ubah nominal | Bot minta balas dengan nominal yang benar, mis. `127500` |
| ❌ Batal | Buang hasil baca (foto ikut dihapus dari Storage) |

Setelah disimpan, tombol **↩️ Batalkan** tetap ada seperti transaksi teks biasa.

## 5. Penyimpanan foto (opsional, keputusan #3)

- Bucket **private** `receipts` di Supabase Storage. Free tier 1 GB setara dengan ±5.000 foto struk.
- Path `receipts/<household_id>/<uuid>.jpg`. Policy Storage hanya mengizinkan anggota household yang sama untuk membaca.
- Kolom baru `transactions.receipt_path`.
- Di web, transaksi yang punya struk menampilkan ikon 🧾. Kalau diklik, foto dibuka lewat *signed URL* yang berlaku 5 menit.
- Kalau transaksi dihapus, fotonya ikut dihapus.

## 6. Biaya (perkiraan)

Satu foto struk dari Telegram (±1280 px) sekitar 2.000 token gambar, ditambah ±800 token prompt dan daftar item, ditambah ±700 token output (termasuk proses berpikir model). Kurs ±Rp 16.000/USD.

| Model | Per struk | 100 struk/bulan | 300 struk/bulan |
|---|---|---|---|
| `claude-opus-5-5` | ±$0,025 (≈ Rp 400) | ±$2,5 (≈ Rp 40rb) | ±$7,5 (≈ Rp 120rb) |
| `claude-haiku-5-5` | ±$0,0006 (≈ Rp 10) | ±$0,06 (≈ Rp 1rb) | ±$0,19 (≈ Rp 3rb) |

Biaya ini ditagih dari **kredit Anthropic API** (prepaid, top-up minimal di console). Supabase dan Telegram tetap gratis.

## 7. Keamanan & privasi

- **API key Anthropic** disimpan di Supabase Secrets (`ANTHROPIC_API_KEY`), tidak pernah ada di web atau repo.
- **Hanya akun Telegram yang sudah terhubung** yang bisa mengirim struk. Foto dari orang lain diabaikan, jadi tidak ada biaya API yang terbuang.
- **Batas pemakaian:** maks. 30 struk/hari per rumah tangga, untuk mencegah biaya tak terduga kalau bot di-spam.
- **Isi struk dikirim ke Anthropic API** untuk dibaca. Struk bisa memuat 4 digit kartu atau nama kasir; data API tidak dipakai untuk melatih model.
- **Isi struk diperlakukan sebagai data, bukan instruksi.** Teks aneh di foto, misalnya "abaikan instruksi", tidak bisa mengubah perilaku bot. Hasilnya juga divalidasi ulang: total harus > 0, dan item, hutang, maupun tabungan harus milik rumah tangga itu.

## 8. Perubahan teknis

| Bagian | Perubahan |
|---|---|
| Migrasi 7 | `transactions.receipt_path`, bucket `receipts` + policy Storage, kolom `kind` di `telegram_pending` |
| `_shared/receipt.ts` | Prompt + JSON schema + pemanggilan Claude (`npm:@anthropic-ai/sdk`) + validasi hasil |
| `telegram-webhook` | Tangani `message.photo` & `message.document` (image/PDF), background processing, tombol konfirmasi |
| Web | Ikon 🧾 + lihat foto struk di daftar transaksi; hapus foto saat transaksi dihapus |
| Test | Unit test validasi hasil + test integrasi webhook dengan Claude & Telegram dipalsukan |
| Setup | Buat API key di console.anthropic.com → simpan ke Supabase Secrets → deploy ulang fungsi |

**Fase 2 (nanti):** upload struk langsung dari web (tombol 📷 di dialog Catat transaksi), dengan alur yang sama.

## 9. Keputusan yang perlu kamu ambil

1. **Model AI:**
   - **Opus 5.5:** paling akurat, ±Rp 400 per struk. Ini default.
   - **Haiku 5.5:** ±Rp 10 per struk. Cukup akurat untuk foto yang jelas, tapi lebih sering salah di struk kusut atau tulisan tangan.
2. **Konfirmasi dulu atau langsung simpan?** Saran: konfirmasi dulu, karena salah baca angka di struk lebih berisiko daripada di input teks.
3. **Simpan foto struk** di Supabase Storage supaya bisa dilihat lagi di web? Saran: ya.
4. **Daftar item struk** dimasukkan ke catatan transaksi, misalnya "Beras 5kg, Minyak 2L, +3 lainnya"? Saran: ya, diringkas.
5. **Upload dari web** dikerjakan sekarang, atau nanti setelah versi Telegram jalan? Saran: nanti.

## 10. Catatan saat ditunda: opsi biaya

User ingin opsi **gratis**. Claude API tidak punya free tier. Opsi yang dibahas:

| Opsi | Biaya | Catatan |
|---|---|---|
| A. Gemini API free tier | Rp 0 | Kuota harian; di free tier Google boleh memakai isi permintaan untuk melatih produk dan reviewer manusia bisa membacanya; aturan free tier bisa berubah |
| B. Claude Haiku 5.5 | ±Rp 10/struk (top-up min. $5 ≈ ±8.000 struk) | Data API tidak dipakai melatih model |
| C. Tesseract OCR di browser | Rp 0 | Akurasi paling rendah, tanpa AI, hanya via upload web (terlalu berat untuk Edge Function gratis) |

Kalau dilanjutkan, provider AI dibuat bisa diganti lewat satu pengaturan (mis. `RECEIPT_AI_PROVIDER`), supaya bisa mulai dari A lalu pindah ke B tanpa mengubah fitur.

