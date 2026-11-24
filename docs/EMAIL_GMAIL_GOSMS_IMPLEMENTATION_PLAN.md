# Rencana Implementasi Notifikasi: Gmail SMTP + GoSMS

Tanggal audit: 24 November 2026. Status: **implementasi awal A/B/C tersedia; aktivasi provider dan scope bersyarat belum selesai**.

## Status eksekusi 24 November 2026

- Implementasi tersedia: dedicated worker, migration additive tracking delivery, enkripsi payload baru, template Gmail invitation/reset dan email operasional, permission-based recipient resolver, dry-run, lease/fencing, retry aman, persistent quota/pause, heartbeat, dan CLI/deploy guide.
- Adapter GoSMS disiapkan untuk kontrak legacy v2, diuji tanpa provider nyata. Live SMS routing sengaja ditolak sampai kontrak provider, identitas kontak customer, serta consent disepakati.
- Migration `20261124010000_notification_delivery` sudah tercatat diterapkan pada database Neon di `apps/api/.env` (`prisma migrate status`, 24 November 2026). Aktivasi Gmail dan bukti inbox, kredensial/sender GoSMS, kontak customer, OTP, reminder, bounce otomatis, dan UI retry admin belum selesai. Jangan menganggap seluruh checkbox rencana di bawah sudah terpenuhi.
- Saat dokumen rencana pertama dibuat belum ada perubahan aplikasi; implementasi berikutnya tidak mengaktifkan live send. Semua flag contoh tetap off.
- Runbook dan nama script nyata: [NOTIFICATIONS_DEPLOYMENT.md](NOTIFICATIONS_DEPLOYMENT.md). Untuk hasil validasi akhir lihat bagian hasil eksekusi di akhir dokumen.

Repository target: `F:\Nakes`. Referensi audit legacy: `F:\nakes-backend`.

## 1. Keputusan dan batas scope

- Email tahap awal memakai **Gmail SMTP**, bukan Resend. Tidak perlu akun/API key Resend.
- SMS tetap menggunakan GoSMS, dengan adapter terpisah dari email.
- Reuse transactional outbox, autentikasi, order, dan layanan domain existing. Jangan mengirim pesan langsung dari transaksi domain.
- Login existing tidak berubah menjadi login OTP. Verifikasi nomor adalah fitur tambahan, bukan prasyarat baru untuk seluruh pengguna.
- Tidak mengubah POS, pembayaran, dokumen, inventory, maupun workflow verifikasi/order yang tidak terkait.
- Pembuatan dokumen awal tidak mengaktifkan worker atau mengirim pesan. Eksekusi kode setelahnya menambah dependency dan migration file; migration hanya diuji pada schema terisolasi.
- Nama environment/tabel/script yang sudah tersedia dirinci dalam runbook; endpoint OTP, SMS customer, dan reminder tetap **usulan**, bukan fitur aktif.

## 2. Hasil audit legacy

### GoSMS dan API aplikasi

`app/Services/GoSmsService.php` menggunakan bearer token dan payload `to`, `message`, serta `sender` opsional:

```text
POST https://server.gosmsgateway.com/api/v2/sms-otp/send
Authorization: Bearer <GO_SMS_API_KEY>
```

Endpoint di atas berasal dari default konfigurasi repository, bukan bukti endpoint akun produksi masih sama.

| Akun | Registrasi: mengirim OTP | Resend: mengirim OTP | Verifikasi: tidak mengirim |
|---|---|---|---|
| Customer | `POST /api/v1/customer/register` | `GET /api/v1/customer/resend-otp` | `POST /api/v1/customer/verify-otp` |
| Nakes/HCP | `POST /api/v1/hcp/register` | `GET /api/v1/hcp/resend-otp` | `POST /api/v1/hcp/verify-otp` |
| Faskes/HCF | `POST /api/v1/hcf/register` | `GET /api/v1/hcf/resend-otp` | `POST /api/v1/hcf/verify-otp` |

Konfigurasi lama: `GO_SMS_BASE_URL`, `GO_SMS_API_KEY`, `GO_SMS_SENDER`.

Temuan yang **tidak boleh disalin** ke implementasi baru:

- OTP dikembalikan sebagai data response resend oleh service/controller.
- Resend faskes memakai property `$goSmsService`, sementara constructor menyimpan `$goSms`.
- Resend nakes/faskes menyimpan tipe `customer`; lookup verifikasi hanya berdasarkan nomor.
- OTP memakai `rand()` dan disimpan plaintext; belum ada pembatasan percobaan/cooldown khusus OTP. Throttle umum API tersedia, 120 request/menit per user/IP.
- SMS registrasi dipanggil sebelum transaksi database commit; pengiriman bisa berhasil tetapi penyimpanan akun gagal.
- Adapter hanya melempar HTTP error; belum ada validasi sukses bisnis, pencatatan delivery, dan kebijakan retry/timeout eksplisit.

### Email dan push

- Laravel menyediakan konfigurasi SMTP dan alur reset password web melalui `Auth::routes()`/`SendsPasswordResetEmails`.
- Belum ditemukan implementasi email bisnis khusus untuk order dan verifikasi. Konfigurasi mailer tidak membuktikan pengiriman nyata berhasil.
- `MustVerifyEmail` pada model User tidak diimplementasikan, sehingga listener registrasi bukan bukti verifikasi email aktif.
- Ada `NakesNotification` dan `ChatController` untuk FCM, tetapi dependency terkait tidak tercantum di Composer dan pemanggilannya belum lengkap. Tidak diprioritaskan dalam tahap ini.
- Audit bersifat statis; tidak melakukan live test SMTP/GoSMS atau memeriksa nilai `.env` sebenarnya.

## 3. Kondisi Nakes baru dan routing notifikasi

File existing utama:

- `apps/api/src/modules/notifications/outbox.service.ts`: enqueue event dan interface dispatcher; belum ada worker pengiriman.
- `apps/api/prisma/schema.prisma`: `NotificationOutbox` dengan status `PENDING`, `SENT`, `FAILED`, attempts, lastError, availableAt, dan sentAt.
- `apps/api/src/modules/auth/account-tokens.service.ts`: invitation dengan token sekali pakai.
- `apps/api/src/modules/auth/auth.service.ts`: reset password, token sekali pakai dan response anti-enumerasi.
- `apps/api/src/modules/orders/`: event order, status, expiry, dan reschedule.

| Event existing | Kanal awal | Resolver penerima/ketentuan |
|---|---|---|
| `ACCOUNT_INVITATION` | Email | Email user; cek akun dan token masih berlaku sebelum kirim |
| `PASSWORD_RESET_REQUESTED` | Email | Email user aktif; jangan kirim link lama/sudah dipakai |
| `FACILITY_APPLICATION_SUBMITTED` | Email | Tentukan reviewer platform aktif berdasarkan permission; recipient belum tersedia pada event |
| `FACILITY_VERIFICATION_DECIDED` | Email | Owner klinik dari event; tangani penerima kosong |
| `PRACTITIONER_SUBMITTED` | Email | Resolver reviewer platform aktif; recipient belum tersedia |
| `PRACTITIONER_VERIFICATION_DECIDED` | Email | Email nakes bila tersedia dan layak dikirimi |
| `AFFILIATION_PROPOSED` | Email | Resolver reviewer sesuai workflow existing |
| `AFFILIATION_DECIDED` | Email | Owner klinik dari event |
| `ORDER_SUBMITTED` | Email | Owner klinik dari event; bukan seluruh user platform |
| `ORDER_STATUS_CHANGED` | Email; SMS selektif nanti | Selesaikan kontrak kontak customer lebih dahulu |
| `ORDER_RESCHEDULED` | Email; SMS selektif nanti | Kontak customer terverifikasi, waktu lama/baru dan zona waktu benar |

Event order untuk customer membawa `customerId`, bukan email/nomor customer. Jangan otomatis memakai nomor di `patientSnapshot`: pasien belum tentu pemesan. Siapkan resolver terpercaya dari aplikasi customer atau kontrak kontak yang disepakati; perubahan kontrak harus backward-compatible dan tervalidasi. Bila belum tersedia, tandai `BLOCKED` dengan alasan, jangan mengarang penerima.

Reminder jadwal dan OTP adalah **fitur tambahan**, bukan event yang sudah tersedia. Reminder harus dibatalkan/diganti saat reschedule, cancel, reject, expired, atau status terminal lainnya agar tidak mengirim jadwal lama.

## 4. Setup Gmail SMTP saat deploy

### Prasyarat operator

1. Gunakan akun Gmail khusus aplikasi, bukan mailbox pribadi developer.
2. Aktifkan 2-Step Verification dan simpan recovery akun dengan aman.
3. Buat App Password khusus aplikasi melalui halaman Google Account. Jangan memakai password login biasa atau fitur "less secure apps".
4. Simpan App Password hanya pada secret manager/environment server. Jangan masukkan ke Git, browser, log, screenshot, atau chat.
5. Jika App Password tidak tersedia karena kebijakan organisasi/Advanced Protection, hentikan setup berbasis password dan rencanakan OAuth2 SMTP. Jangan menonaktifkan keamanan akun untuk memaksakan konfigurasi.
6. Pastikan server dapat mengakses outbound `smtp.gmail.com:587`; gunakan `465` bila kebijakan jaringan membutuhkan implicit TLS.

App Password membutuhkan 2-Step Verification dan dapat dicabut ketika password akun Google berubah. Google merekomendasikan autentikasi berbasis OAuth bila tersedia. Lihat [panduan App Password Google](https://support.google.com/accounts/answer/185833).

### Environment usulan

Tambahkan ke validasi dan `.env.example` **pada saat implementasi**, bukan sekadar menyalin blok ini ke server saat kode belum mendukungnya:

```dotenv
# Default aman: worker tidak mengirim pesan.
NOTIFICATIONS_ENABLED=false
NOTIFICATIONS_MODE=dry-run
NOTIFICATIONS_EMAIL_ENABLED=false
NOTIFICATIONS_SMS_ENABLED=false
NOTIFICATIONS_RECIPIENT_ALLOWLIST=
NOTIFICATIONS_LIVE_FROM=

MAIL_TRANSPORT=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
SMTP_USER=akun-khusus-aplikasi@gmail.com
SMTP_PASSWORD=REPLACE_WITH_APP_PASSWORD
MAIL_FROM_NAME=Nakes
MAIL_FROM_ADDRESS=akun-khusus-aplikasi@gmail.com
MAIL_REPLY_TO=

# Usulan pembatas aplikasi; bukan kuota resmi Google.
NOTIFICATIONS_POLL_INTERVAL_MS=5000
NOTIFICATIONS_BATCH_SIZE=10
NOTIFICATIONS_CONCURRENCY=1
NOTIFICATIONS_MAX_ATTEMPTS=5
SMTP_MAX_MESSAGES_PER_MINUTE=5
SMTP_MAX_MESSAGES_PER_DAY=100

GO_SMS_BASE_URL=
GO_SMS_API_KEY=
GO_SMS_SENDER=
GO_SMS_OTP_PATH=
GO_SMS_TRANSACTIONAL_PATH=
GO_SMS_TIMEOUT_MS=10000
```

- `587`: `secure=false`, tetapi wajib upgrade STARTTLS (`requireTLS=true`). Bukan pengiriman tanpa enkripsi.
- `465`: `secure=true` untuk TLS sejak koneksi dibuka. Jangan menonaktifkan validasi sertifikat pada kedua mode.
- Gunakan sender yang sama dengan akun SMTP; alias hanya jika benar-benar sudah dikonfigurasi dan diverifikasi. Jangan memalsukan domain sender.
- `NOTIFICATIONS_MODE`: hanya `dry-run` atau `live`. Boolean/string/angka wajib diparse dan divalidasi, jangan memakai truthiness string `"false"`.
- Staging wajib allowlist penerima dan menolak pengiriman di luar daftar, bukan mengalihkan link/token pengguna asli ke sembarang alamat uji.
- `NOTIFICATIONS_LIVE_FROM`: timestamp UTC cutoff untuk event baru yang boleh dikirim. Backlog lama harus direview eksplisit, bukan otomatis dikuras.
- Angka rate limit di atas adalah starting point konservatif. Counter harus persistent/shared antar worker dan restart; sesuaikan hasil uji serta jenis akun.

Port dan enkripsi mengikuti [dokumentasi SMTP Google](https://developers.google.com/workspace/gmail/imap/imap-smtp). Gmail memiliki pembatasan pengiriman dan dapat memblokir sementara akun yang mencapai limit; akun Workspace memiliki aturan berbeda. Jangan anggap kuota sebagai jaminan throughput. Lihat [batas Gmail](https://support.google.com/mail/answer/22839).

### Keterbatasan SMTP yang harus terlihat di UI/log

- SMTP accepted berarti server menerima pesan untuk diproses, **bukan bukti masuk inbox atau dibaca**.
- Tidak ada webhook delivery/bounce Resend pada rancangan Gmail SMTP ini. Jangan membuat label `DELIVERED` berdasarkan `sendMail()` saja.
- Simpan message ID, waktu accepted, dan kode error aman. Pemantauan bounce mailbox otomatis merupakan scope terpisah; tahap awal operator memeriksa mailbox khusus.
- `transporter.verify()` menguji koneksi/auth, bukan membuktikan email template terkirim atau masuk inbox.
- SMTP tidak memberikan jaminan exactly-once. Jika koneksi putus setelah DATA diserahkan, hasil mungkin ambigu: tandai `UNKNOWN`, jangan retry otomatis tanpa penilaian risiko pesan ganda.

## 5. Arsitektur dan migration yang direncanakan

Alur: perubahan domain + event dalam transaksi existing -> commit -> worker mengklaim delivery -> adapter Gmail/GoSMS -> simpan hasil per penerima/kanal.

### Penyimpanan

- Pertahankan `NotificationOutbox` sebagai sumber event. Tambahkan tabel `NotificationDelivery` melalui **migration additive**; jangan reset schema atau hapus data existing.
- Field minimal usulan: id, outboxId, channel, recipientKey, recipient terlindungi, templateVersion, status, attempts, availableAt, leaseToken, leaseUntil, providerMessageId, acceptedAt, lastErrorCode, createdAt, updatedAt.
- Status per-delivery usulan: `PENDING`, `PROCESSING`, `ACCEPTED`, `FAILED`, `BLOCKED`, `SKIPPED`, `UNKNOWN`. `DELIVERED` hanya jika provider menyediakan bukti delivery yang dapat diverifikasi.
- Unique `(outboxId, channel, recipientKey)` mencegah fan-out ganda. Claim memakai transaksi/conditional update atau `FOR UPDATE SKIP LOCKED`; lease dan penyelesaian wajib memakai fencing token agar worker lama tidak menimpa hasil worker baru.
- Lease yang habis tidak otomatis berarti aman kirim ulang: proses yang mungkin sudah mencapai provider masuk rekonsiliasi `UNKNOWN`.
- Mapping kompatibel outbox: `SENT` hanya setelah semua delivery yang wajib telah accepted; bukan delivered. `FAILED` untuk kegagalan terminal; `BLOCKED`/`UNKNOWN` tetap terlihat sebagai belum selesai. Event yang seluruhnya skipped perlu penanda skip/alasan eksplisit melalui additive field, jangan dilabeli seolah terkirim.
- Tentukan satu pemilik attempts/error per-delivery; field agregat outbox hanya ringkasan. Jangan mengulang kanal sukses ketika kanal lain gagal.
- Tidak perlu Redis/BullMQ pada tahap awal; gunakan PostgreSQL existing untuk claim/lease/rate limit dan loop worker dengan graceful shutdown.

### Retry dan pengamanan

- Retry hanya kegagalan transient yang aman: misalnya koneksi gagal sebelum submit atau penolakan sementara yang pasti belum diterima. Usulan backoff berjitter: 1 menit, 5 menit, 15 menit, 1 jam; maksimal 5 percobaan total.
- Kredensial salah, alamat invalid, dan penolakan permanen tidak di-retry terus. Quota/auth failure harus mem-pause kanal dan memberi alarm operasional, bukan menambah spam request.
- Hormati waktu reset quota/Retry-After bila tersedia. Gagal notifikasi tidak boleh menggagalkan order atau mengembalikan transaksi bisnis yang sudah commit.
- Dry-run membuat hasil simulasi terpisah, tanpa menandai delivery production `ACCEPTED` atau menghabiskan event/token. Jangan mencatat body email, URL token, atau OTP saat dry-run.
- Jangan replay notifikasi status order lama sebagai status terkini. Terapkan aturan freshness/version; event yang superseded ditandai skipped.

### Token dan privasi

- Token akun existing di-hash pada tabel token, tetapi URL lengkap di payload outbox masih memuat raw token. Lindungi payload sensitif menggunakan mekanisme enkripsi yang ter-review, masking, kontrol akses, dan retention/purge; jangan mengubah key existing tanpa rencana rotasi.
- Sebelum pengiriman, cek token belum expired, belum dipakai, belum digantikan, dan status user sesuai. Jangan otomatis memperpanjang token saat worker terlambat.
- Escape semua konten dinamis HTML, sediakan plain text, dan gunakan URL aplikasi dari konfigurasi terpercaya. Jangan menerima `to`, sender, template, atau redirect bebas dari request publik.
- Jangan kirim hasil klinis, scan STR/SIP, password, atau informasi pasien lengkap. Isi order cukup referensi, jadwal, dan link login dengan otorisasi existing.
- Tidak menyediakan public endpoint kirim-email/SMS bebas. Operasi retry nantinya harus permission-scoped, diaudit, rate-limited, dan memeriksa eligibility ulang.

## 6. Integrasi GoSMS

- Konfirmasi dokumentasi dari akun provider: base URL, endpoint OTP versus SMS transaksi, authentication, sender, format nomor, response sukses/gagal parsial, message ID, quota, biaya/segmen, serta delivery report.
- Situs publik menampilkan contoh endpoint berbeda dari legacy dan menyebut dokumentasi lengkap tersedia untuk pengguna terdaftar. Jangan mengganti endpoint hanya berdasarkan contoh marketing. [Referensi resmi GoSMS](https://gosmsgateway.com/).
- Gunakan timeout HTTP eksplisit, validasi HTTP **dan** body sukses bisnis. Jangan menganggap HTTP 200 atau status queued sebagai SMS delivered.
- Normalisasi nomor Indonesia ke format yang disyaratkan provider setelah validasi. Jangan menebak nomor invalid atau mengambil nomor pasien sebagai kontak customer.
- Pengiriman SMS transaksi memerlukan kontak yang berhak menerima, preferensi/persetujuan yang sesuai, serta budget/rate limit. Default fitur SMS tetap off.
- Jangan aktifkan webhook sebelum signature/authenticity contract provider diketahui. Jika hanya mendukung polling, rancang rekonsiliasi terpisah dengan rate limit.
- Timeout setelah submit dapat berarti SMS sudah terproses. Gunakan idempotency/reference resmi bila tersedia; jika tidak ada, tandai ambiguous/UNKNOWN dan hindari retry buta yang menambah biaya.
- OTP baru, jika disetujui: generator kriptografis, challengeId, hash berkunci/HMAC dengan secret khusus, purpose + nomor + akun terikat, TTL pendek, atomic consume, batas percobaan, cooldown resend, dan limit per nomor/IP/akun. Response tidak pernah membawa kode. Challenge terbaru membatalkan yang lama; material pengiriman harus terlindungi dan dihapus setelah tidak diperlukan.
- Jangan menambahkan endpoint OTP ke Nakes baru sampai kebutuhan verifikasi nomor dan pemilik identitas customer disepakati. Endpoint Laravel lama tetap hanya referensi audit.

## 7. Tahapan eksekusi dan target file

### Tahap A — Fondasi, tanpa live send

- [ ] Konfirmasi akun Gmail khusus, ketersediaan App Password, pengelola secret, dan penerima staging.
- [x] Re-audit diff yang sudah ada; pertahankan perubahan user.
- [x] Tambahkan `notifications.module.ts`, dispatcher/router, repository delivery, dan worker entry point di `apps/api/src/modules/notifications/`.
- [x] Tambahkan migration `NotificationDelivery`, index claim/deduplikasi, dan field agregat skip bila dibutuhkan; review rollback yang non-destruktif.
- [x] Tambahkan validasi environment ke `apps/api/src/config/env.validation.ts` dan contoh aman di `apps/api/.env.example`.
- [x] Tambahkan Nodemailer beserta tipe TypeScript sebagai dependency SMTP minimal setelah memeriksa versi kompatibel/lockfile. Tidak perlu framework mailer besar. Lihat [SMTP transport Nodemailer](https://nodemailer.com/smtp).
- [x] Implementasikan `gmail-smtp.adapter.ts`, template email HTML/text, dan masking error/log.
- [x] Worker punya process/service terpisah, graceful shutdown, health/heartbeat, lease, concurrency, dan persistence rate limit.
- [x] Tambahkan script worker/check pada `apps/api/package.json` dan konfigurasi deploy; dokumentasikan nama script sebenarnya setelah dibuat.

Kriteria selesai: dry-run dan unit/integration test lolos; worker tidak dapat mengirim live secara default.

### Tahap B — Email akun

- [x] Hubungkan `ACCOUNT_INVITATION` dan `PASSWORD_RESET_REQUESTED` tanpa mengubah kontrak login/reset existing.
- [x] Gunakan `INVITATION_URL`, `INVITATION_TTL_HOURS`, `PASSWORD_RESET_URL`, dan `PASSWORD_RESET_TTL_MINUTES` existing; pastikan URL HTTPS production.
- [x] Lewati token expired/used/superseded dan event lama; pastikan anti-enumerasi reset tetap berlaku.
- [ ] Jalankan test koneksi SMTP secara eksplisit; kemudian test pengiriman nyata hanya ke akun uji allowlisted atas persetujuan operator.
- [ ] Verifikasi inbox dan spam manual, link valid, link hanya bisa dipakai sekali, dan sender benar.

Kriteria selesai: invitation/reset sampai ke akun uji dan semua pengamanan tetap berlaku. SMTP accepted dicatat terpisah dari verifikasi inbox manual.

### Tahap C — Email operasional

- [x] Tambahkan resolver recipient untuk reviewer, owner, dan nakes sesuai tabel routing.
- [x] Tambahkan template verifikasi, afiliasi, serta order masuk.
- [ ] Selesaikan kontrak kontak customer sebelum mengaktifkan email status/reschedule customer.
- [ ] Tampilkan jadwal dalam zona waktu klinik yang benar, termasuk waktu lama/baru pada reschedule.
- [ ] Jika menambahkan daftar/retry notifikasi admin: pakai permission dan audit existing, scope data, masking penerima/token; jangan mengubah modul klinik lain.

### Tahap D — GoSMS dan reminder opsional

- [ ] Dapatkan dokumentasi API akun, aktifkan sender, dan implementasikan adapter dengan response nyata yang sudah disanitasi sebagai fixture test.
- [x] Uji failure, timeout ambigu, queued versus delivered, dan proteksi duplikasi tanpa SMS nyata pada CI (mock transport/response, bukan bukti kontrak provider produksi).
- [ ] Aktifkan SMS transaksi hanya untuk event penting yang telah disepakati dan kontak terverifikasi.
- [ ] OTP dan reminder dikerjakan sebagai slice terpisah setelah kebutuhan identitas dan jadwal disetujui.

## 8. Checklist validasi dan perintah

Perintah berikut sudah tersedia dan dijalankan dari root `F:\Nakes` **setelah implementasi**, bukan klaim sudah dijalankan untuk dokumen ini:

```powershell
pnpm --filter @nakes/api prisma:validate
pnpm --filter @nakes/api prisma:generate
pnpm --filter @nakes/api test --runInBand
pnpm lint
pnpm typecheck
pnpm build
```

Migration development dibuat/direview pada database lokal terisolasi dengan `prisma:migrate`. Saat deploy, setelah backup dan pemeriksaan target database, jalankan:

```powershell
pnpm --filter @nakes/api prisma:deploy
```

`prisma:deploy` hanya menerapkan migration yang sudah dibuat; dokumen ini tidak membuat migration apa pun. Jangan memakai migrate reset atau seed produksi untuk mengaktifkan notifikasi.

Kasus uji wajib:

- [ ] Dua worker bersamaan menghasilkan satu delivery; lease/fencing mencegah overwrite dan kirim ganda.
- [ ] Rollback transaksi domain tidak menghasilkan pesan; provider gagal tidak merusak order.
- [ ] Crash sebelum/selama/setelah submit; kondisi ambigu tidak otomatis dikirim ulang.
- [ ] Dry-run/default disabled tidak menghubungi SMTP/GoSMS dan tidak menghabiskan outbox live.
- [ ] Retry tidak mengulang kanal/penerima yang sudah accepted; limit persistent tetap berlaku setelah restart.
- [ ] Auth failure, quota, timeout, HTTP sukses dengan body SMS gagal, serta invalid recipient tertangani.
- [ ] Invitation/reset expired, used, superseded, disabled user, dan backlog lama dilewati dengan alasan aman.
- [ ] HTML injection, URL/token/OTP di log, recipient di luar allowlist, serta akses retry lintas klinik ditolak.
- [ ] Reschedule/cancel membatalkan reminder lama; event status lama tidak membingungkan penerima.
- [ ] Smoke/regresi invitation, staff/user, verifikasi, order, dan reschedule memakai database/schema terisolasi; notifikasi nyata selalu off.
- [ ] CI memakai mock transport/fake provider; tidak memakai secret production atau melakukan live send.

Jika ada perubahan API publik/admin, regenerasi kontrak dengan `pnpm contracts:generate` dan perbarui `docs/API_ENDPOINTS.md`/`docs/SWAGGER.md`. Jika tidak ada perubahan kontrak, jangan menghasilkan diff kontrak tanpa alasan.

## 9. Runbook aktivasi dan rollback

1. Backup database, review migration additive, dan pastikan semua dependency/script dari tahap implementasi sudah tersedia.
2. Deploy API/worker dengan `NOTIFICATIONS_ENABLED=false`; terapkan migration dan cek health.
3. Jalankan dry-run dengan data uji; jangan tampilkan payload sensitif pada output.
4. Konfigurasi Gmail secret, uji koneksi, lalu staging live dengan allowlist dan satu event uji baru. GoSMS tetap disabled.
5. Sebelum production live, review backlog, tentukan cutoff `NOTIFICATIONS_LIVE_FROM`, batalkan link lama, dan pastikan penerima/URL sesuai environment.
6. Aktifkan email lebih dahulu dengan batch/concurrency kecil. Pantau oldest pending age, failure/UNKNOWN, accepted count, quota pause, heartbeat, dan mailbox bounce.
7. Aktifkan GoSMS hanya setelah slice D lolos dan operator menyetujui biaya/penerima. Jangan mengaktifkan semua kanal sekaligus.
8. Jika bermasalah: set global/email/SMS flag off sesuai kanal, hentikan intake/claim baru dan drain proses aktif dengan aman. Pesan yang sudah accepted tidak dapat ditarik; jangan replay massal setelah restart.
9. Pertahankan tabel migration additive saat rollback aplikasi; jangan menghapus audit/delivery atau secret lama tanpa rencana pemulihan. Rotasi credential jika terindikasi bocor.

## 10. Definition of done

- Gmail SMTP berjalan untuk email akun, kemudian event operasional yang penerimanya sudah jelas.
- GoSMS terkonfigurasi dan diuji sesuai dokumentasi akun; kanal opsional tidak menyala tanpa kesiapan.
- Tidak ada klaim delivery inbox palsu, retry buta pada hasil ambigu, duplikasi yang bisa dicegah, atau kebocoran token/OTP.
- Workflow existing dan seluruh validasi/regresi yang relevan tetap lolos.
- Environment example, migration, deployment guide, daftar script worker/check, dan hasil test diperbarui sesuai implementasi nyata.
- Batas yang belum selesai (kontak customer, OTP, reminder, bounce otomatis) dilaporkan eksplisit; tidak dianggap sudah aktif.

**Titik mulai yang direkomendasikan:** Tahap A lalu B. GoSMS, kontak customer, dan reminder tidak menjadi penghambat pengiriman invitation/reset lewat Gmail.

## 11. Hasil validasi implementasi

- Prisma schema validation dan client generation: lolos.
- Unit test API: **390 test / 20 suite lolos**, termasuk 52 test notifikasi.
- Regresi real HTTP/PostgreSQL: **120 pemeriksaan lolos** untuk dokumen nakes, pembatalan, expiry, permission/scope, concurrency, dan rollback. Runner telah membersihkan schema acak serta file temporernya.
- Lint dan typecheck API/admin-web: lolos. Build API dan admin-web: lolos.
- Smoke notifikasi PostgreSQL: **35 pemeriksaan lolos** dengan fake transport, termasuk kegagalan penyimpanan agregat setelah acknowledgment, claim dua worker, fencing, quota persisten, dan pemulihan crash. Schema acak runner telah dibersihkan.
- `git diff --check` dan syntax check runner smoke: lolos.
- Tidak ada live SMTP/GoSMS test, tidak ada provider delivery/inbox yang telah dibuktikan, dan tidak ada migration ke schema operasional. Perlu release migration sebelum API/worker versi baru dijalankan.
