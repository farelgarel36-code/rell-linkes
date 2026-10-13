# Rell Linkes

Website download responsif dengan:
- Katalog dan pencarian file publik.
- Upload file lokal melalui panel admin.
- Tautan eksternal (Google Drive, MediaFire, dan URL HTTP/HTTPS).
- Hitungan unduhan dan penghapusan item.
- Login admin dengan bcrypt, pembatasan percobaan login, sesi SQLite, dan batas ukuran upload.

## Catatan penting
- Server ini menerima semua jenis file sesuai kebutuhan. Karena itu, admin harus hanya mengunggah file yang dipercaya dan berhak dibagikan.
- Untuk produksi, gunakan HTTPS dan penyedia hosting yang mendukung Node.js serta **persistent disk**. File dan database akan hilang jika direktori `DATA_DIR` tidak persisten atau hosting menghapus penyimpanan saat deploy/restart.
- Jangan menjalankan situs ini dengan password contoh atau mengunggah `.env` ke GitHub.
- Tautan eksternal akan mengarahkan pengunjung ke situs tujuan. Pastikan URL aman dan legal.
- Tidak ada pemindaian antivirus otomatis. Peringatkan pengunjung untuk memindai file sebelum membukanya.
- Untuk file sangat besar atau trafik tinggi, simpan file di object storage (misalnya S3-compatible storage) dan gunakan link unduhan langsung/presigned, bukan disk server aplikasi.

## 1. Siapkan konfigurasi
Butuh Node.js 18 atau lebih baru. Salin `.env.example` menjadi `.env`, lalu buat hash password admin. Contoh di komputer/terminal yang punya Node.js:
```bash
node -e "console.log(require('bcryptjs').hashSync('GANTI_DENGAN_PASSWORD_KUAT', 12))"
```
Salin hasil `$2a$...` ke `ADMIN_PASSWORD_HASH`. Ubah `ADMIN_USERNAME`, `SESSION_SECRET`, dan `DATA_DIR`.
Buat `SESSION_SECRET` acak panjang. Contoh:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Contoh `.env`:
```env
PORT=3000
NODE_ENV=production
SESSION_SECRET=hasil-random-panjang-di-sini
ADMIN_USERNAME=nama-admin
ADMIN_PASSWORD_HASH=$2a$12$hasil-hash-password-di-sini
DATA_DIR=./data
MAX_FILE_MB=500
```

## 2. Jalankan secara lokal
```bash
npm install
npm start
```
Buka `http://localhost:3000`. Login admin melalui `/admin/login`.
Untuk tes lokal, `secure` cookie hanya bekerja pada HTTPS dalam production. Jika perlu menguji login dengan HTTP lokal, ubah `NODE_ENV=development` di `.env`.

## 3. Hosting dari Android
Pilihan paling praktis:
1. Siapkan akun GitHub dan buat repository private.
2. Unggah isi folder project (jangan unggah `.env`, `data/`, `node_modules/`).
3. Pilih layanan hosting yang mendukung aplikasi Node.js, environment variables, dan persistent disk/volume.
4. Buat Web Service dari repository.
5. Build/install command: `npm install`
6. Start command: `npm start`
7. Tambahkan environment variables: `NODE_ENV=production`, `SESSION_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `MAX_FILE_MB`, dan `DATA_DIR`.
8. Pasang persistent disk/volume, lalu set `DATA_DIR` ke path mount disk tersebut, misalnya `/var/data/rell-linkes`.
9. Deploy, buka URL HTTPS yang diberikan hosting, lalu tes login, upload, download, dan restart untuk memastikan file masih ada.

Nama menu dan lokasi persistent disk berbeda antar penyedia. Jangan memilih hosting serverless tanpa disk persisten untuk upload lokal. Paket gratis juga dapat punya batas storage, bandwidth, ukuran file, atau bisa tidur saat tidak aktif.

## 4. Upload dari HP
Di Android, gunakan browser untuk membuka URL admin `/admin/login`. Login, lalu:
- Form **Upload file** untuk mengirim file dari penyimpanan HP.
- Form **Tambah link eksternal** untuk menambahkan URL unduhan.
- Bagian **Kelola file** untuk menghapus item.
Untuk file besar, upload melalui koneksi Wi-Fi yang stabil. Batas default 500 MB dapat diubah lewat `MAX_FILE_MB`, sesuai kemampuan hosting.

## Struktur
- `server.js` — server, database, autentikasi, upload/download.
- `public/style.css` — desain responsif.
- `data/uploads/` — file yang diunggah.
- `data/db/rell-linkes.sqlite` — katalog file dan data unduhan.
