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
| 503 | Layanan belum tersedia; booking mengembalikan `BOOKINGS_DISABLED` jika key belum dikonfigurasi |

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
- Cancellation, expiry, no-show, reschedule, dan kebijakan pembayaran belum diimplementasikan. Nilai enum yang dicadangkan bukan endpoint fitur yang tersedia.

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

PDF, JPEG, dan PNG didukung, maksimum 10 MiB. Ukuran file dan signature konten diperiksa, bukan hanya nama ekstensi. Signed URL berlaku mengikuti `DOCUMENT_URL_TTL_SECONDS` (default 300 detik). Upload scan STR/SIP praktisi belum tersedia; jangan menyamakan API dokumen fasilitas dengan fitur tersebut.
