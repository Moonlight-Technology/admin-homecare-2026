# Deploy notifikasi Gmail SMTP dan persiapan GoSMS

Implementasi 24 November 2026. Email menggunakan Gmail SMTP, bukan Resend. Worker berjalan terpisah dari API. Semua fitur pengiriman default **off**; credential dan aktivasi nyata tetap tugas operator.

## Yang tersedia

- Worker PostgreSQL outbox: fan-out terdeduplikasi, claim/lease/fencing, retry terbatas, shared persistent quota, circuit breaker, dan heartbeat.
- Email invitation/reset password dengan pengecekan ulang token, status akun, URL aplikasi, serta penerima sebelum kirim.
- Email generik verifikasi klinik/nakes, afiliasi, dan order masuk. Reviewer dipilih dari permission aktif, owner dari membership aktif.
- Template HTML/plain text tanpa data medis/review notes; waktu order mengikuti zona waktu order.
- Customer status/reschedule diblokir `CUSTOMER_CONTACT_UNRESOLVED`; tidak memakai nomor pasien sebagai pengganti.
- Adapter GoSMS untuk kontrak legacy v2 dipersiapkan dan diuji dengan fake response. **Belum ada live SMS routing**, OTP endpoint, reminder, webhook provider, atau UI retry admin.
- Payload outbox baru dan alamat per-delivery dienkripsi AES-GCM dengan key turunan terpisah dari `CREDENTIAL_ENCRYPTION_KEY`. Jangan mengganti key ini tanpa migrasi/rotasi; ciphertext lama akan tidak terbaca.
- Payload token dihapus setelah seluruh delivery akun terminal; retention 30 hari juga membersihkan payload akun yang macet/ambigu (selain yang sedang processing). Mailbox Gmail sendiri tetap menyimpan email terkirim; terapkan kebijakan akses dan retention mailbox terpisah.

## 1. Migration dan build

Backup database dan periksa target koneksi sebelum deploy. Migration additive `20261124010000_notification_delivery` menambah tracking delivery/control/simulation dan dua field outbox; tidak mengirim pesan atau menghapus tabel existing.

```powershell
# Dari root repo; setelah dependency terpasang sesuai lockfile.
pnpm --filter @nakes/api prisma:generate
pnpm --filter @nakes/api build
# Release step pada database target yang sudah diverifikasi:
pnpm --filter @nakes/api prisma:deploy
```

API dan worker versi baru membutuhkan migration tersebut sebelum dijalankan. Jangan `migrate reset` atau seed production. Pengujian agent hanya menerapkan migration pada schema acak terisolasi, bukan schema operasional.

## 2. Siapkan Gmail

Gunakan akun aplikasi khusus, aktifkan 2-Step Verification, lalu buat App Password. Simpan secret hanya di environment server/secret manager. Password login Gmail biasa tidak digunakan. Jika kebijakan akun melarang App Password, jangan turunkan keamanan akun; evaluasi OAuth2 SMTP terlebih dahulu. App Password dapat dicabut saat password akun berubah. [Panduan Google](https://support.google.com/accounts/answer/185833).

Konfigurasi awal: salin **nama key saja** dari `apps/api/.env.example`, isi credential pada server, dan pertahankan:

```dotenv
NOTIFICATIONS_ENABLED=false
NOTIFICATIONS_MODE=dry-run
NOTIFICATIONS_EMAIL_ENABLED=false
NOTIFICATIONS_SMS_ENABLED=false
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
SMTP_USER=akun-aplikasi@gmail.com
SMTP_PASSWORD=REPLACE_ON_SERVER_ONLY
MAIL_FROM_ADDRESS=akun-aplikasi@gmail.com
MAIL_FROM_NAME=Nakes
NOTIFICATIONS_CONCURRENCY=1
SMTP_MAX_MESSAGES_PER_MINUTE=5
SMTP_MAX_MESSAGES_PER_DAY=100
```

Port 587 mewajibkan STARTTLS; port 465 memakai `SMTP_SECURE=true`. Verifikasi sertifikat tidak dinonaktifkan. [Dokumentasi SMTP Google](https://developers.google.com/workspace/gmail/imap/imap-smtp).

Pengirim harus sama dengan akun SMTP. URL `INVITATION_URL`, `PASSWORD_RESET_URL`, dan `WEB_ORIGIN` harus benar; HTTPS wajib untuk live production. Cek server dapat mengakses outbound Gmail port yang dipilih. Rate limit aplikasi memakai bucket menit/hari UTC dan menghitung reservasi percobaan secara konservatif, bukan hanya email sukses. Ini bukan jaminan kuota Google. [Batas Gmail](https://support.google.com/mail/answer/22839).

## 3. Dry-run tanpa pengiriman

Set `NOTIFICATIONS_ENABLED=true`, `NOTIFICATIONS_MODE=dry-run`, email/SMS tetap false. Jalankan dari root:

```powershell
pnpm --filter @nakes/api notifications:once
pnpm --filter @nakes/api notifications:check
```

Script membaca `.env` melalui Nest ConfigModule, tidak mencetak credential/payload. Dry-run menulis ringkasan ke `notification_simulations`; tidak membuat live delivery, memakai token, memanggil SMTP/GoSMS, atau menandai event SENT. Setiap event disimulasikan sekali; tabel ini bukan bukti email terkirim. Event di luar batch diproses pada tick berikutnya. `notifications:check` menampilkan hitungan live delivery, heartbeat, pending tertua, dan pause kanal; hasil simulasi dapat diperiksa langsung oleh operator DB tanpa membuka payload.

## 4. Staging live secara terbatas

1. Tetapkan `NOTIFICATIONS_LIVE_FROM` ke timestamp UTC rollout, misalnya format `2026-11-24T05:00:00.000Z` (ganti dengan waktu rollout sebenarnya).
2. Isi `NOTIFICATIONS_RECIPIENT_ALLOWLIST` dengan email akun uji, dipisah koma. Non-production live tanpa allowlist ditolak. Daftar tidak mengalihkan token ke alamat lain; penerima di luar daftar menjadi BLOCKED.
3. Set mode `live`, global flag true dan email true; SMS tetap false.
4. Cek koneksi/auth secara eksplisit:

```powershell
pnpm --filter @nakes/api notifications:smtp-check
```

Perintah ini menghubungi Gmail, tetapi tidak mengirim email dan bukan bukti inbox berhasil.

5. Buat invitation/reset baru melalui workflow aplikasi existing, hanya untuk akun uji yang diizinkan. Jangan membuat endpoint kirim-email bebas.
6. Jalankan `notifications:once`. Periksa inbox/spam manual, sender, link sekali pakai, dan masa berlaku. Jangan menampilkan link/token pada log/screenshots.
7. Uji ulang invitation, reset, dan keputusan verifikasi/afiliasi; cocokkan status dengan halaman aplikasi.

Event sebelum cutoff ditandai skipped saat materialisasi, tidak dikirim massal. Memajukan cutoff juga melindungi delivery lama yang belum dikirim. Jangan memundurkan cutoff untuk menguras backlog tanpa review. Invitation/reset lama yang sudah dilewati harus diterbitkan ulang melalui workflow existing, bukan menghidupkan kembali token lama.

## 5. Worker production

Terapkan migration terlebih dahulu. API biasa tidak memulai worker. Jalankan satu proses worker awalnya; replikasi didukung claim/lease/quota bersama.

```powershell
pnpm --filter @nakes/api notifications:worker
```

Atau build image API existing dari root dan gunakan service khusus:

```powershell
docker build -f apps/api/Dockerfile -t nakes-api:local .
docker compose -f deploy/notifications/docker-compose.yml up -d
```

Compose tidak menyediakan database baru. Pastikan URL database/MinIO/app dapat diakses dari jaringan container; `localhost` container bukan host database. Gunakan environment production yang sesuai dan jangan commit `.env`. Port aplikasi tidak perlu dipublikasikan untuk worker.

Mode/flag dibaca saat startup: perubahan environment memerlukan restart worker (dan API jika konfigurasi enkripsi/URL berubah). Restart normal menunggu tick selesai melalui SIGTERM/SIGINT; timeout container 90 detik. Setelah crash, lease 5 menit dipulihkan: sebelum submit aman kembali PENDING; sesudah submit menjadi UNKNOWN untuk rekonsiliasi manual.

## 6. Status, alarm, dan pemulihan

- `ACCEPTED`: SMTP menerima pesan. Bukan bukti delivered/inbox/read. Outbox agregat `SENT` memakai arti accepted yang sama.
- `providerMessageId` untuk Gmail berisi SMTP Message-ID korelasi dari Nodemailer, bukan bukti delivery atau ID Gmail API. Message-ID stabil membantu pencarian mailbox, tetapi tidak menjamin deduplikasi oleh Gmail.
- `SKIPPED`: token/event tidak relevan, cutoff, atau penerima tak lagi berhak. Alasan tersedia tanpa payload sensitif; outbox yang semuanya skipped tetap tidak dilabeli SENT.
- `BLOCKED`: data penerima/kontrak belum siap, tidak allowlisted, event belum didukung, atau payload tak terbaca. Tidak di-retry otomatis.
- `UNKNOWN`: koneksi/worker gagal setelah pesan mungkin diserahkan. Jangan kirim ulang massal; periksa Sent mailbox/provider sebelum tindakan manual.
- `FAILED`: kegagalan permanen atau percobaan habis.
- Auth/quota SMTP mem-pause kanal secara shared selama 24 jam; perbaiki credential/limit dan evaluasi pause sebelum melanjutkan. Tidak ada endpoint publik untuk membuka pause atau retry.

```powershell
pnpm --filter @nakes/api notifications:check
# Health probe tanpa data pribadi:
pnpm --filter @nakes/api exec node dist/notification-check.js --health
```

Monitor pending age, FAILED/BLOCKED/UNKNOWN, heartbeat lebih tua dari 3 menit, dan `channel:EMAIL` pause. Heartbeat menunjukkan worker hidup, bukan bukti provider sehat. Periksa mailbox bounce secara manual; webhook bounce/read dan IMAP reader tidak diimplementasikan.

Rollback aman: matikan global/email flag dan hentikan worker dengan graceful shutdown. API tetap melayani bisnis tanpa pengiriman. Pertahankan tabel additive dan audit, jangan DROP tracking atau replay seluruh delivery. Pesan yang sudah accepted tidak dapat ditarik. Untuk insiden credential, cabut App Password dan rotasi secret secara terencana.

## 7. GoSMS: apa yang masih dibutuhkan

`gosms.adapter.ts` tidak dihubungkan ke customer/order routing. Bahkan `NOTIFICATIONS_SMS_ENABLED=true` pada mode live ditolak validator sampai pekerjaan kontrak berikut selesai. Tidak ada fallback otomatis ke SMS saat Gmail gagal.

Dapatkan dokumentasi dari akun GoSMS: endpoint, sender, format nomor, kontrak respons, delivery report, timeout/idempotency, dan persetujuan penerima. Adapter persiapan saat ini hanya mengenali kontrak legacy v2 terkonfirmasi (`GO_SMS_CONTRACT=legacy-v2-confirmed`) dengan `success=true`, `data.queued=1`, `data.failed=0`. Kontrak berbeda membutuhkan perubahan adapter/test; jangan menebak dari HTTP 200. Timeout menjadi UNKNOWN dan tidak retry buta. Endpoint OTP dan transactional terpisah, tidak dipakai saling menggantikan. [Referensi resmi GoSMS](https://gosmsgateway.com/sms-api).

Kontak customer, OTP challenge, dan reminder tetap slice terpisah. Jangan memakai `patientSnapshot.phone`; pasien dan pemesan bisa berbeda. Aktivasi SMS memerlukan implementasi routing/consent dan pengujian provider baru, bukan sekadar mengganti flag.

## 8. Pengujian tanpa provider nyata

```powershell
pnpm --filter @nakes/api test --runInBand
pnpm lint
pnpm typecheck
pnpm build
```

Uji PostgreSQL terisolasi setelah API build, dari `apps/api`:

```powershell
$env:SMOKE_ALLOW_ISOLATED_SCHEMA = '1'
node --env-file=.env test/smoke/notifications.mjs
```

Runner hanya membuat/menghapus schema acak `nakes_notifications_<hex>` miliknya. Ia memakai fake transport, tidak mengirim Gmail/GoSMS, tidak memakai akun user existing, dan menolak `NODE_ENV=production`. Koneksi existing hanya dipakai untuk CREATE/DROP schema acak; migration tidak diterapkan ke schema operasional. Bila cleanup gagal, nama schema terisolasi dilaporkan untuk operator. Jangan menjalankan smoke pada database production.
