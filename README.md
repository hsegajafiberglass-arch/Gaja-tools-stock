# GAJA STOCK CONTROL PRO v2

PT Graha Adhi Jaya Abadi — aplikasi web multi-user untuk gudang alat kerja.

## Fitur tambahan versi Pro
- Branding PT Graha Adhi Jaya Abadi
- Login Admin / Warehouse / Viewer
- Foto alat kerja
- QR Code unik setiap alat
- Status: Gudang, Project, Dipinjam, Maintenance, Rusak
- Project dan holder/pemegang alat
- Serah-terima alat ke project dengan approval Admin
- Stok otomatis berkurang setelah approval
- Pengembalian alat otomatis menambah stok
- Notifikasi stok minimum, maintenance, dan alat rusak
- Rekap CSV
- Laporan bulanan PDF
- Histori stok sebelum/sesudah transaksi
- Persistent database + upload foto

## Login awal
Username: admin
Password: Admin123!

Segera ganti password setelah deployment.

## Jalankan lokal
Node.js 20+

```bash
npm install
npm start
```
Buka http://localhost:3000

## Deploy Render
1. Upload seluruh isi paket ke GitHub.
2. Render > New > Blueprint.
3. Hubungkan repository.
4. render.yaml akan membuat web service + persistent disk.
5. Setelah deployment selesai, gunakan URL HTTPS yang diberikan Render.

## Catatan
QR Code menggunakan PUBLIC_URL bila env tersebut diisi. Jika tidak, URL dibangun dari host aplikasi saat ini.
Untuk produksi wajib gunakan JWT_SECRET yang aman, HTTPS, dan backup folder /data secara berkala.
