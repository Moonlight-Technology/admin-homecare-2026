# Dokumentasi Swagger API Nakes

Dokumen ini mengikuti controller, DTO, guard, dan service di `apps/api`. Kontrak mesin tersedia di [openapi.json](../packages/api-contracts/openapi.json); daftar route dan permission tersedia di [API_ENDPOINTS.md](API_ENDPOINTS.md).

## Membuka Swagger

Siapkan environment dan database sesuai [README](../README.md), lalu jalankan dari root repository:

```sh
pnpm dev:api
```

- Swagger UI: <http://localhost:4000/api/docs>
- OpenAPI JSON saat API berjalan: <http://localhost:4000/api/docs-json>
- Base URL API: `http://localhost:4000/api/v1`
- Health: `GET /api/v1/health`

Swagger UI mengikuti konfigurasi existing: tersedia ketika `NODE_ENV` bukan `production`. File OpenAPI tetap bisa diimpor ke Postman, Insomnia, atau Swagger Editor. Semua path dalam file sudah berawalan `/api/v1`; server URL cukup origin, jangan menambahkan `/api/v1` lagi.

## Memperbarui dokumentasi

```sh
pnpm contracts:generate
```

Command ini membangun API, memperbarui `packages/api-contracts/openapi.json`, menghasilkan `docs/API_ENDPOINTS.md`, dan memperbarui tipe TypeScript `packages/api-contracts/src/schema.d.ts`. Export memakai Nest preview dan tidak membuka koneksi database. Tambahkan informasi endpoint melalui decorator Swagger dan DTO di source agar export berikutnya mempertahankan dokumentasi.

## Autentikasi dan scope

| Penggunaan | Kredensial | Cara mengirim |
|---|---|---|
| Admin platform / klinik | Access JWT dari login | `Authorization: Bearer <accessToken>`; Authorize → `bearer` |
| Membuat booking dari backend customer app | `BOOKINGS_API_KEY` | `Authorization: Bearer <BOOKINGS_API_KEY>`; Authorize → `bookingKey` |
| Refresh / logout | Cookie HTTP-only `nakes_rt` | Cookie dari login dan header `Origin` yang persis sama dengan `WEB_ORIGIN` |
| Upload / download dokumen | Signed token dalam URL | Gunakan URL yang diterbitkan API, termasuk query `token` |
| Discovery publik / registrasi / health | Tidak diperlukan | Lihat operasi publik di Swagger |

Klinik dapat mengirim `X-Facility-Id` untuk memilih salah satu membership klinik aktif milik pengguna. Jika header tidak dikirim, API memilih membership fasilitas aktif yang paling awal dibuat. Header ini tidak memberi akses ke klinik lain. Permission platform dan fasilitas terpisah; semua permission yang tercantum di `x-access.permissions` wajib dimiliki.

Contoh berikut menggunakan Bash/curl; pada PowerShell gunakan `curl.exe` dan sesuaikan penulisan variabel serta kelanjutan baris.

```sh
API=http://localhost:4000/api/v1
ORIGIN=http://localhost:3000

curl -i -c cookies.txt "$API/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@nakes.local","password":"<password-akun>"}'
```

Login mengembalikan `accessToken` dan `expiresIn` dalam detik, sekaligus memasang cookie refresh. Isi `TOKEN` dengan access token hasil login:

```sh
TOKEN='<accessToken>'
curl "$API/me" -H "Authorization: Bearer $TOKEN"

curl -b cookies.txt -c cookies.txt -X POST "$API/auth/refresh" \
  -H "Origin: $ORIGIN"

curl -i -b cookies.txt -X POST "$API/auth/logout" \
  -H "Origin: $ORIGIN"
```

Refresh merotasi cookie; simpan cookie terbaru. Browser memakai `credentials: 'include'` untuk login/refresh/logout. Cookie HTTP-only dikelola browser dan tidak diisi manual melalui Authorize. Jika origin Swagger berbeda dari `WEB_ORIGIN`, uji refresh/logout dari aplikasi web yang sesuai atau curl; browser menetapkan header Origin sendiri.

## Konvensi request dan response

- JSON request memakai `Content-Type: application/json`. Properti asing ditolak oleh validation pipe.
- UUID diperlukan pada ID yang memakai `ParseUUIDPipe`; ID path tidak valid dapat menghasilkan HTTP 400.
- Sukses dikembalikan langsung, tanpa pembungkus `data` atau `success`. HTTP 204 tidak memiliki body.
- List yang memakai pagination mengembalikan `{ items, page, limit, total }`. `page` mulai 1, `limit` default 20 dan maksimum 100. Parameter pencarian, filter, dan sorting yang didukung ditampilkan per endpoint.
- Nilai uang memakai IDR dan database Decimal; perlakukan nilai decimal JSON sebagai nilai presisi, jangan mengasumsikan semuanya JavaScript number.
- Timestamp jadwal memakai ISO 8601. Jam operasional memakai timezone fasilitas: `Asia/Jakarta`, `Asia/Makassar`, atau `Asia/Jayapura`.
- `X-Request-Id` dipakai untuk pelacakan request. Rate limit berlaku per instance; endpoint login dan registrasi mempunyai batas lebih ketat.

Contoh bentuk list (ilustrasi struktur, bukan fixture klinik nyata):

```json
{ "items": [], "page": 1, "limit": 20, "total": 0 }
```

Contoh error validasi:

```json
{
  "code": "VALIDATION_FAILED",
  "message": "Some fields are invalid.",
  "details": { "fields": { "email": ["email must be an email"] } },
  "requestId": "<request-id>"
}
```

| Status | Arti umum |
|---|---|
| 400 | Request / parameter path tidak valid |
| 401 | Kredensial tidak ada, salah, atau kedaluwarsa |
| 403 | Permission, membership, Origin, atau signed token tidak sesuai |
| 404 | Resource tidak ditemukan / tidak terlihat pada scope pengguna |
| 409 | Data duplikat, transisi status, kapasitas, atau idempotency conflict |
| 422 | Validasi DTO / domain; cek `details.fields` jika tersedia |
| 429 | Rate limit tercapai |
| 503 | `DATABASE_UNAVAILABLE` untuk gangguan koneksi/pool database sementara; booking juga dapat mengembalikan `BOOKINGS_DISABLED` jika key belum dikonfigurasi |

`DATABASE_UNAVAILABLE` menyertakan header `Retry-After: 2`. Pembacaan metadata dokumen di luar transaksi
dicoba ulang maksimal dua kali untuk gangguan koneksi yang dikenali. Write, transaksi, dan stream upload tidak
diulang otomatis: periksa status terbaru sebelum mengulangi POST/PUT agar tidak menggandakan operasi.
Sertakan `requestId` saat melaporkan kegagalan; detail database tidak dikirim ke client.

Daftar error umum di Swagger menjelaskan envelope yang sama lintas modul; tidak setiap endpoint memiliki seluruh kondisi error tersebut. Beberapa response sukses masih bertipe service/Prisma dan belum memiliki schema response DTO eksplisit; Swagger tidak mengarang bentuk response yang belum dideklarasikan.

## Discovery dan booking

1. `GET /public/facilities` untuk mencari klinik verified dan aktif.
2. `GET /public/facilities/{id}` untuk detail klinik.
3. `GET /public/facilities/{id}/offerings?mode=HOMECARE` untuk layanan yang dipublikasikan dan mode yang tersedia.
4. `GET /public/facilities/{id}/slots` dengan parameter sesuai Swagger; gunakan slot hasil API sebagai `scheduledAt`.
5. Backend customer app memanggil `POST /bookings` dengan booking key dan `Idempotency-Key`.

```sh
BOOKING_KEY='<BOOKINGS_API_KEY>'
curl "$API/bookings" \
  -H "Authorization: Bearer $BOOKING_KEY" \
  -H 'Idempotency-Key: customer-booking-attempt-001' \
  -H 'Content-Type: application/json' \
  -d '{
    "customerId":"11111111-1111-4111-8111-111111111111",
    "patient":{"id":"22222222-2222-4222-8222-222222222222","name":"Pasien Contoh","phone":"081234567890"},
    "facilityId":"33333333-3333-4333-8333-333333333333",
    "mode":"HOMECARE",
    "scheduledAt":"2026-12-01T01:00:00.000Z",
    "items":[{"offeringId":"44444444-4444-4444-8444-444444444444","quantity":1}],
    "address":{"line":"Jl. Contoh No. 5","postalCode":"40111"}
  }'
```

ID dan tanggal di atas hanya contoh: ganti dengan customer/patient ID dari aplikasi customer, klinik/layanan nyata, dan slot tersedia. `address` wajib untuk HOMECARE. Harga dihitung ulang oleh server; satu kunjungan homecare memakai visit fee tertinggi dari layanan yang dipesan.

`Idempotency-Key` wajib 8–100 karakter: huruf, angka, titik, underscore, titik dua, atau tanda minus. Retry dengan key dan payload sama mengembalikan order sama. Key sama dengan payload berbeda ditolak. Booking pending belum mereservasi kapasitas; approval klinik memeriksa dan mereservasi kapasitas secara atomik.

## Operasional klinik

Alur yang tersedia: registrasi/profil → upload dokumen → pengajuan verifikasi → review platform → publish offering → atur availability → terima booking → approve/reject → assign praktisi → start → update item → complete.

- Approval membutuhkan klinik aktif/verified dan slot yang masih tersedia.
- Assignment membutuhkan praktisi verified, aktif, berafiliasi aktif pada tanggal kunjungan, dan tidak bentrok dengan kunjungan lain.
- Kunjungan dimulai setelah seluruh assignment lengkap; completion membutuhkan semua item selesai atau `NOT_PERFORMED` dengan alasan.
- Tampilan order platform membatasi data pasien dan alamat sesuai implementasi existing.
- Pembatalan oleh klinik tersedia lewat `POST /clinic/orders/:id/cancel` dengan permission `order:approve` dan body `{ "reason": "Permintaan pembatalan pasien" }` (5–1000 karakter setelah trim).
  Hanya `PENDING_APPROVAL`/`CONFIRMED`; status lain atau request berulang menghasilkan 409. Untuk confirmed,
  satu kapasitas slot dan seluruh penugasan aktif dilepas dalam transaksi yang sama dengan history, audit, dan
  antrean notifikasi. Slot yang hilang/kosong/tidak sesuai klinik menghasilkan `409 SLOT_RESERVATION_MISSING`
  tanpa perubahan parsial. Harga, pembayaran dan riwayat penugasan dipertahankan; tidak ada refund otomatis.
- Expiry approval tersedia sebagai worker internal, default nonaktif (`ORDER_APPROVAL_EXPIRY_MODE=off`). Pilih
  `after_creation` + `ORDER_APPROVAL_EXPIRY_MINUTES`, atau `at_visit`; tidak ada endpoint publik untuk memicu worker.
  Semua pending existing mengikuti konfigurasi saat ini. Worker memproses maksimal 25 order tiap 60 detik dan saat
  startup; transaksi/CAS mencegah event ganda lintas instance. Order confirmed/in-progress tidak di-expire.
  Approval terlambat mengembalikan `409 ORDER_APPROVAL_EXPIRED` setelah menyimpan status EXPIRED, tanpa mengambil
  slot. Jika worker lain menang race, kode konflik status lain dapat muncul; baca ulang detail order.
  History memakai actor sistem (null), audit `ORDER_EXPIRED`, dan antrean notifikasi ditulis atomik. Snapshot
  harga/pembayaran tidak diubah. Restart API setelah mengganti kebijakan; tinjau backlog sebelum mengaktifkan.
- No-show manual: `POST /clinic/orders/:id/no-show`, permission `order:progress`, body `{ "reason": "Pasien tidak datang dan tidak dapat dihubungi" }` (trim 5–1000 karakter).
  Aturan awal konservatif: hanya confirmed, seluruh item masih pending, dan waktu server sudah mencapai jadwal
  ditambah total durasi × quantity. Sebelum itu `409 NO_SHOW_TOO_EARLY` + `details.eligibleAt`; layanan yang
  sudah diproses menghasilkan `409 ORDER_SERVICES_ALREADY_PROGRESSED`. Status lain/race memberi konflik 409.
  NO_SHOW, seluruh item NOT_PERFORMED + reason/history, penutupan penugasan, audit `ORDER_NO_SHOW` dan outbox
  disimpan atomik. Slot lampau dan reserved count dipertahankan sebagai riwayat; harga/pembayaran tidak berubah.
  Tidak ada no-show otomatis, denda, refund, atau pembukaan ulang order. Platform tetap read-only.
- Reschedule klinik: permission `order:approve`, `GET /clinic/orders/:id/reschedule-slots?date=YYYY-MM-DD` memakai
  tanggal lokal klinik dan durasi snapshot order. `POST /clinic/orders/:id/reschedule` memakai body
  `{ "scheduledAt": "<UTC slot start>", "version": 0, "reason": "Pasien meminta jadwal baru" }`.
  Hanya confirmed dengan jadwal lama masih di masa depan, reservasi lama tersedia, dan seluruh item pending.
  Target harus slot masa depan ≤60 hari, tidak penuh/terblokir, dan cukup untuk seluruh durasi × quantity.
  Nakes tetap ditugaskan tetapi diverifikasi ulang status/afiliasi pada tanggal lokal baru dan konflik lintas
  klinik. Versi usang, jadwal sama, klinik/nakes tidak aktif, slot invalid/penuh dan konflik menghasilkan 409.
  Reservasi baru, pelepasan lama, waktu/versi order, history CONFIRMED→CONFIRMED, audit dan outbox
  `ORDER_RESCHEDULED` atomik. Alasan wajib 5–1000 karakter; harga, pembayaran, mode, layanan dan klinik tidak berubah.
  Reload setelah konflik; tidak ada write retry otomatis, biaya, refund, ataupun reschedule otomatis.
- Pembatalan oleh pelanggan dan kebijakan pembayaran/refund belum diimplementasikan. Nilai enum yang dicadangkan bukan endpoint fitur yang tersedia.

## Upload dokumen verifikasi

1. `POST /clinic/documents/upload-init` dengan access JWT, scope klinik, serta JSON `requirementId`, `fileName`, `mimeType`, `sizeBytes`.
2. Gunakan `upload.url` pada response untuk mengirim file mentah via PUT. Kirim `Content-Type` sesuai `upload.headers`. Jangan gunakan multipart/form-data.
3. `POST /clinic/documents/complete` dengan `{ "documentId": "<document.id>" }`.
4. `GET /clinic/documents/{id}/url` untuk URL baca bertanda tangan.

```sh
curl -i -X PUT '<upload.url-dari-response>' \
  -H 'Content-Type: application/pdf' \
  --data-binary '@dokumen.pdf'
```

PDF, JPEG, dan PNG didukung, maksimum 10 MiB. Ukuran file dan signature konten diperiksa, bukan hanya nama ekstensi. Signed URL berlaku mengikuti `DOCUMENT_URL_TTL_SECONDS` (default 300 detik). Satu upload hanya menerima satu PUT sukses; bila respons PUT terputus setelah file diterima, coba complete, bukan menimpa file dengan PUT ulang. Jika proses berhenti saat upload masih berjalan, buat upload-init baru.

### Scan STR/SIP tenaga kesehatan

Endpoint praktisi terpisah dari dokumen fasilitas. Gunakan prefix `/admin/practitioners/{id}` untuk reviewer
platform (`practitioner:review`) atau `/clinic/practitioners/{id}` untuk pengelola afiliasi (`affiliation:manage`).
Klinik harus menjadi pendaftar nakes tersebut dan masih memiliki afiliasi PROPOSED/ACTIVE. Afiliasi saja dengan
nakes yang didaftarkan pihak lain tidak memberikan hak membaca scan privatnya.

1. `GET {prefix}/documents` mengembalikan status edit dan kredensial beserta metadata scan saat ini.
2. `POST {prefix}/credentials/{credentialId}/documents/upload-init` dengan JSON `fileName`, `mimeType`, `sizeBytes`.
   Tidak ada `requirementId`, `ownerId`, `objectKey`, maupun nomor STR/SIP dalam payload. Server mengikat file ke
   kredensial yang dipilih dan praktisi pemiliknya.
3. PUT file mentah ke `upload.url`, lalu `POST {prefix}/credentials/{credentialId}/documents/complete`
   dengan `{ "documentId": "<document.id>" }` menggunakan akun yang memulai upload.
4. `GET {prefix}/credentials/{credentialId}/documents/{documentId}/url` menerbitkan link baca sementara yang diaudit.

Kredensial/dokumen di luar scope menghasilkan 404. Dokumen belum diunggah atau signature/ukuran tidak cocok tidak
dapat dilampirkan. Status UNDER_REVIEW/VERIFIED mengunci init dan complete; status DRAFT/SUBMITTED/
REVISION_REQUIRED/REJECTED mengizinkan unggahan. Status verifikasi/operasional tidak otomatis berubah karena upload.
Scan lama tetap tersimpan; keputusan review menyimpan snapshot ID scan dan approval menerima scan yang dilampirkan.
Kebutuhan scan tidak dijadikan syarat wajib baru bagi alur verifikasi existing. Email tetap ditunda.
