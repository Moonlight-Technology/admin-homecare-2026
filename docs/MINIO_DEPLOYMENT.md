# MinIO untuk deployment Nakes

Storage server Nakes memakai **MinIO private** dengan `STORAGE_DRIVER=minio`. Integrasi tetap menggunakan driver S3-compatible existing. Endpoint aplikasi, validasi PDF/JPEG/PNG maksimum 10 MiB, audit, dan signed link API tidak berubah.

Konfigurasi ini menargetkan **Ubuntu Server 24.04 LTS, satu server Linux**, dengan API dan MinIO di mesin yang sama. Untuk API di mesin lain, gunakan jaringan private/VPN dan TLS; endpoint `127.0.0.1` tidak dapat dipakai lintas server. Tidak ada instalasi atau perubahan environment server yang dijalankan otomatis oleh repository.

## File yang dipakai

| File | Fungsi |
|---|---|
| [compose.yml](../deploy/minio/compose.yml) | MinIO server, healthcheck, persistent disk, bootstrap dan admin tools |
| [Dockerfile](../deploy/minio/Dockerfile) | Build server dan `mc` dari release source upstream yang dipin |
| [.env.example](../deploy/minio/.env.example) | Template konfigurasi dan kredensial server MinIO |
| [api-storage.env.example](../deploy/minio/api-storage.env.example) | Konfigurasi storage yang digabung ke environment API |
| [init.sh](../deploy/minio/init.sh) | Membuat bucket private, versioning, policy dan akun aplikasi |
| [app-policy.json](../deploy/minio/app-policy.json) | Permission aplikasi hanya pada bucket dokumen |

MinIO Community saat dokumen disusun sudah source-only dan repository upstream diarsipkan. Setup membangun server `RELEASE.2025-10-15T17-29-55Z` dan client `RELEASE.2025-08-13T08-35-41Z` sendiri; tidak memakai `minio/minio:latest` atau mirror pihak ketiga. Release server tersebut mencakup perbaikan session policy bypass. Ini bukan jaminan tidak ada kerentanan lain: arsip upstream berarti pemeliharaan/security review menjadi tanggung jawab operator. Simpan image hasil build di registry sendiri, pindai image/dependencies sebelum rilis, dan pin digest image yang sudah diterima. Sumber dan ketentuan AGPL tersedia pada repository upstream, bukan bagian dari kode proprietary aplikasi Nakes.

Referensi resmi:

- [MinIO repository dan status distribusi](https://github.com/minio/minio)
- [Release server yang digunakan](https://github.com/minio/minio/releases/tag/RELEASE.2025-10-15T17-29-55Z)
- [Release MinIO Client](https://github.com/minio/mc/releases/tag/RELEASE.2025-08-13T08-35-41Z)
- [Instalasi Docker Engine untuk Ubuntu](https://docs.docker.com/engine/install/ubuntu/)

## Arsitektur dan akses

```text
Browser ── HTTPS ── Nakes API ── jaringan lokal/private ── MinIO :9000
                         │                                │
                  metadata di PostgreSQL       /srv/nakes/minio/data

Operator ── SSH tunnel ── MinIO Console :9001
```

Browser mengunggah dan membaca melalui URL bertanda tangan **Nakes API**, bukan URL bucket MinIO. Tidak perlu public bucket, CORS MinIO, subdomain storage, atau mengekspos port 9000 ke internet. Signed URL berlaku default 300 detik, mengikuti `DOCUMENT_URL_TTL_SECONDS`. Reverse proxy HTTPS API perlu menerima body setidaknya 10 MiB; misalnya pada server block Nginx API gunakan `client_max_body_size 12m;`.

Port API MinIO dan console hanya di-bind ke `127.0.0.1`. Akun root dipakai operator/bootstrap; API hanya mendapat akun aplikasi dengan `GetObject`, `PutObject`, `DeleteObject`, `ListBucket`, dan `GetBucketLocation` pada bucket dokumen. API tidak diberi hak admin, membuat bucket, menghapus bucket, atau menghapus versi lama.

Ini setup single-node/single-disk, bukan high availability. Gunakan disk persisten yang sesuai kapasitas, backup offsite dan monitoring disk. Root filesystem container read-only; data ditulis ke bind mount oleh UID/GID `10001:10001`. Gunakan enkripsi disk sesuai kebutuhan server. Jangan mengisi `S3_SERVER_SIDE_ENCRYPTION=AES256` tanpa KMS MinIO yang sudah dipasang dan diuji; flag itu sendiri tidak menyiapkan enkripsi MinIO.

## 1. Instal Docker dan Compose pada server

Jika Docker Engine dan Compose plugin sudah terpasang, cukup cek `docker version` dan `docker compose version`, lalu lanjut ke langkah 2. Instalasi awal dari repository resmi Docker:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

. /etc/os-release
printf 'Types: deb\nURIs: https://download.docker.com/linux/ubuntu\nSuites: %s\nComponents: stable\nArchitectures: %s\nSigned-By: /etc/apt/keyrings/docker.asc\n' \
  "$VERSION_CODENAME" "$(dpkg --print-architecture)" \
  | sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker version
sudo docker compose version
```

Contoh command selanjutnya mengasumsikan akun operator sudah memiliki akses Docker. Gunakan `sudo docker ...` jika belum. Penambahan user ke grup Docker memberi hak setara root dan tidak diperlukan untuk menjalankan setup ini.

## 2. Siapkan checkout, disk, dan environment MinIO

Contoh checkout aplikasi berada di `/opt/nakes`. Jalankan command dari checkout yang sudah berisi file deploy ini.

```bash
cd /opt/nakes/deploy/minio
sudo install -d -m 0750 -o 10001 -g 10001 /srv/nakes/minio/data
test ! -e .env && cp .env.example .env
chmod 600 .env
```

Jika `.env` sudah ada, gunakan file existing. Jangan menimpa kredensial yang sedang dipakai. Edit file dengan editor server, misalnya `nano .env`, lalu isi:

```dotenv
MINIO_ROOT_USER=nakes-storage-admin
MINIO_ROOT_PASSWORD=<random-root-password>
MINIO_APP_USER=nakes-documents-api
MINIO_APP_PASSWORD=<random-app-password-yang-berbeda>
MINIO_BUCKET=nakes-documents
MINIO_DATA_DIR=/srv/nakes/minio/data
MINIO_API_PORT=9000
MINIO_CONSOLE_PORT=9001
MINIO_BROWSER_REDIRECT_URL=http://localhost:9001
```

Generate **dua** secret berbeda dengan `openssl rand -hex 32`. Isi hasilnya sebagai password root dan app, tanpa karakter `<`/`>`. Secret hex menghindari masalah interpolasi `$` pada file Compose. Bootstrap menolak password contoh, password di bawah 32 karakter, dan root/app yang memakai kredensial sama. Jangan gunakan credential development dari root `docker-compose.yml` di server.

Jika memakai disk terpisah, mount disk lebih dahulu, sesuaikan `MINIO_DATA_DIR`, lalu siapkan ownership `10001:10001` pada direktori yang dipilih. Compose menolak path data yang belum ada. Pastikan mount disk aktif kembali sesudah reboot sebelum container berjalan; gunakan dependency mount pada service host jika diperlukan.

## 3. Build dan bootstrap

Tetap dari `/opt/nakes/deploy/minio`:

```bash
# Helper untuk terminal ini; jalankan lagi jika membuka shell baru.
dc() { docker compose --env-file .env -f compose.yml "$@"; }

dc config --quiet
dc --profile setup build --pull
dc up -d minio
dc run --rm minio-init
dc ps
curl -fsS http://127.0.0.1:9000/minio/health/ready
```

Build pertama mengunduh Go modules dan dapat membutuhkan beberapa menit, RAM, serta ruang disk tambahan. Binaries dikompilasi dari source resmi dengan checksum module Go; builder/runtime base image di-refresh saat `build --pull`.

Bootstrap melakukan:

1. Membuat bucket jika belum ada.
2. Menetapkan anonymous access `none`.
3. Mengaktifkan versioning.
4. Memasang policy aplikasi dengan scope satu bucket.
5. Membuat akun aplikasi jika belum ada, lalu menguji kredensialnya.

Bootstrap boleh diulang. Akun existing **tidak dirotasi password-nya secara otomatis**. Mengubah `MINIO_APP_PASSWORD` saja lalu mengulang init akan gagal verifikasi jika user lama masih memakai password lama; lakukan rotasi terencana dengan akun baru seperti langkah 8.

Periksa konfigurasi tanpa menampilkan secret:

```bash
dc --profile tools run --rm mc anonymous get storage/nakes-documents
dc --profile tools run --rm mc version info storage/nakes-documents
dc --profile tools run --rm mc admin user info storage nakes-documents-api
```

Jika bucket/user diubah dari default, sesuaikan argumen command. Output anonymous access harus `none`, versioning harus enabled, dan app hanya terhubung ke policy `nakes-documents-api`.

## 4. Hubungkan API Nakes

Gabungkan [api-storage.env.example](../deploy/minio/api-storage.env.example) ke environment API existing. **Jangan mengganti seluruh file `.env`**: pertahankan database URLs, `JWT_ACCESS_SECRET`, `STORAGE_SIGNING_SECRET`, dan terutama `CREDENTIAL_ENCRYPTION_KEY` yang digunakan data lama.

```dotenv
NODE_ENV=production
COOKIE_SECURE=true
STORAGE_DRIVER=minio
S3_ENDPOINT=http://127.0.0.1:9000
S3_BUCKET=nakes-documents
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true
S3_ACCESS_KEY_ID=nakes-documents-api
S3_SECRET_ACCESS_KEY=<nilai-MINIO_APP_PASSWORD>
S3_PREFIX=
S3_SERVER_SIDE_ENCRYPTION=
DOCUMENT_URL_TTL_SECONDS=300
WEB_ORIGIN=https://admin.example.com
API_PUBLIC_URL=https://api.example.com/api/v1
```

Ganti domain contoh dengan host deployment. `S3_ACCESS_KEY_ID` sama dengan `MINIO_APP_USER`, bukan root user. `S3_SECRET_ACCESS_KEY` sama dengan password aplikasi. Region dan path-style mempunyai default MinIO pada validator, tetapi sebaiknya tetap ditulis eksplisit.

| Lokasi API | `S3_ENDPOINT` |
|---|---|
| Proses systemd/PM2 di server yang sama | `http://127.0.0.1:9000` |
| Container pada Docker network `nakes-storage` | `http://minio:9000` |
| Server API terpisah | Host private/VPN MinIO dengan TLS dan firewall yang sesuai |

Untuk container API, `127.0.0.1` merujuk ke container API itu sendiri. Tambahkan network storage pada service API existing, sambil mempertahankan network untuk database dan akses keluar:

```yaml
services:
  api:
    # build/image/env_file existing tetap dipakai
    networks: [default, nakes-storage]

networks:
  nakes-storage:
    external: true
    name: nakes-storage
```

Jalankan stack storage lebih dahulu agar network external tersedia. Lakukan migration database sesuai prosedur deploy existing, build API, lalu restart proses/container API agar membaca environment baru. Perubahan driver ini sendiri tidak memerlukan migration schema.

## 5. Verifikasi setelah deploy

Dari root checkout, dengan `.env` API yang sudah mengarah ke MinIO:

```bash
pnpm --filter @nakes/api storage:check
```

Command memverifikasi PUT → HEAD → GET (byte comparison) → DELETE memakai akun aplikasi. Hanya object probe ber-ID random yang disentuh; tidak membuat baris dokumen/pasien. Dengan versioning aktif, versi probe lama tetap ada sampai operator menjalankan retention yang disepakati. Command sengaja menolak driver selain `minio` agar tidak menyentuh backend lama secara tidak sengaja.

Pada image API existing, source dan `tsx` sudah termasuk dari build stage; contoh jika nama service API adalah `api`:

```bash
docker compose exec api pnpm storage:check
```

Script mengasumsikan `.env` tersedia di working directory API. Jika seluruh environment disuntikkan oleh orchestrator tanpa file `.env`, gunakan command tanpa `--env-file`:

```bash
docker compose exec api node dist/storage-check.js
```

Lanjutkan UAT di staging: login sebagai klinik, upload PDF/JPEG/PNG melalui flow dokumen existing, complete upload, lalu buka signed download URL dan cocokkan file. Uji akses anonymous ke object dengan key yang diketahui: harus ditolak. Pastikan signed URL kadaluwarsa sesuai TTL dan akses dokumen lintas klinik tetap ditolak. Smoke suite lengkap berada di [README smoke test](../apps/api/test/smoke/README.md); suite itu membuat data dan hanya untuk local/staging.

`GET /api/v1/health` existing memeriksa database, bukan MinIO. Gunakan `storage:check` untuk verifikasi storage dan monitor MinIO health/disk secara terpisah.

## 6. Akses console dengan SSH tunnel

Di laptop operator:

```bash
ssh -N -L 9001:127.0.0.1:9001 operator@IP_SERVER
```

Buka `http://localhost:9001`, lalu login dengan root credential yang tersimpan pada server. Jika port lokal 9001 sudah dipakai, pilih port lain dan sesuaikan redirect URL console. Operasi admin yang tidak tersedia di console dilakukan dengan service `mc` pada langkah 3. Port 9000/9001 tidak perlu dibuka pada firewall publik.

## 7. Backup dan restore

Versioning membantu pemulihan object yang terhapus/tertimpa, tetapi **bukan backup jika disk/server hilang**. Jangan mengaktifkan auto-delete versi sebelum aturan retensi ditetapkan.

Untuk snapshot konsisten pada deployment satu disk ini, jadwalkan maintenance: hentikan upload/API, hentikan MinIO, backup seluruh direktori data (termasuk `.minio.sys` yang memuat metadata/IAM), lalu hidupkan kembali. Contoh dengan data directory default dan storage shell dari langkah 3:

```bash
# Hentikan API melalui systemd/PM2/Compose yang digunakan deployment Anda terlebih dahulu.
dc stop minio
sudo install -d -m 0700 /srv/backups/nakes-minio
backup_stamp=$(date -u +%Y%m%dT%H%M%SZ)
sudo tar --numeric-owner -czpf "/srv/backups/nakes-minio/minio-${backup_stamp}.tar.gz" \
  -C /srv/nakes/minio data
dc up -d minio
# Hidupkan API dan verifikasi lagi dengan storage:check.
```

Backup juga PostgreSQL, file environment/secrets dan image version yang dipakai. Enkripsi backup dan salin ke lokasi **di luar server**. Uji pemulihan berkala. Archive tar di mesin yang sama saja tidak memenuhi backup offsite.

Untuk restore, hentikan API/MinIO dan ekstrak archive ke direktori **baru yang kosong**, misalnya `/srv/nakes/minio/restore-20261123/`, dengan numeric ownership dipertahankan. Arahkan `MINIO_DATA_DIR` ke subfolder `data` hasil ekstraksi, lalu `dc up -d --force-recreate minio`. Pertahankan folder data lama agar rollback masih tersedia. Gunakan environment/secrets yang sesuai dengan snapshot, restore database pada titik waktu yang konsisten, lalu jalankan `storage:check` dan download beberapa dokumen nyata. Jangan menggabungkan file `.minio.sys` dari dua snapshot berbeda.

## 8. Update, rotasi, dan storage lama

- **Restart/reboot:** `restart: unless-stopped` menghidupkan server kembali. Pastikan mount data aktif dahulu. Bootstrap tidak perlu dijalankan pada setiap restart.
- **Update:** backup, build/pindai source atau base image yang dipilih, simpan image lama/digest-nya, recreate MinIO pada maintenance window, lalu jalankan `storage:check`. Jangan menganggap versi arsip upstream otomatis mendapat patch.
- **Rotasi app credential:** buat user aplikasi kedua dengan policy bucket yang sama melalui `mc`, uji aksesnya, update env API dan restart, lalu nonaktifkan user lama setelah semua instance sudah pindah. Init tidak mengganti password existing. Jangan merotasi `CREDENTIAL_ENCRYPTION_KEY` sebagai bagian dari rotasi storage.
- **Pindah dari local/Cloudinary/S3 lama:** mengganti `STORAGE_DRIVER` tidak memindahkan bytes. Sebelum cutover, inventaris semua `Document.objectKey`, salin bytes ke bucket MinIO dengan key yang sama (tambah `S3_PREFIX` hanya bila sesuai), cocokkan ukuran/checksum, dan uji download. Simpan backend lama sampai cutover terverifikasi. File Cloudinary `authenticated/raw` harus dibaca melalui akses terautentikasi, bukan public URL. Tool migrasi massal tidak dijalankan oleh setup ini.

## Troubleshooting

| Gejala | Periksa |
|---|---|
| `Permission denied` pada `/data` | Mount aktif dan ownership direktori `10001:10001`; jangan mengubah ownership seluruh disk secara rekursif tanpa audit |
| Connection refused di API container | Gunakan `http://minio:9000` dan attach network external, bukan `localhost` |
| `AccessDenied` | Kredensial aplikasi cocok dengan user yang di-bootstrap, policy melekat dan bucket benar |
| `NoSuchBucket` | `minio-init` selesai sukses dan `S3_BUCKET` sama dengan `MINIO_BUCKET` |
| Kesalahan region/signature | `S3_REGION=us-east-1`, path-style true, waktu server sinkron dan endpoint tidak memuat path bucket |
| Init gagal setelah ganti password | User existing tidak dirotasi; pulihkan env sebelumnya atau gunakan user baru dengan prosedur rotasi |
| Upload 413 sebelum masuk API | Batas body reverse proxy minimal 10 MiB plus ruang header; contoh 12m |
| MinIO meminta KMS | Kosongkan flag SSE jika KMS memang belum dikonfigurasi; jangan menganggap data sudah encrypted-at-rest |
| Disk cepat penuh | Versi lama tetap disimpan; pantau kapasitas dan tetapkan kebijakan retensi bersama operator |
| Dokumen lama tidak terbaca setelah cutover | Bytes belum dipindahkan atau key/prefix berubah; jangan menghapus backend lama |

Validasi Docker build/start, IAM dan koneksi nyata harus dilakukan di server/staging yang menyediakan Docker. Pada workspace Windows tanpa Docker, yang dapat diverifikasi hanya konfigurasi secara statis, typecheck, build dan unit test backend.
