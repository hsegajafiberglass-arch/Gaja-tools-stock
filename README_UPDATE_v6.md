# GAJA Stock Control PRO v6 — Batch Handover Approval

Upgrade untuk PT Graha Adhi Jaya Abadi.

## Fitur baru
- Satu pengajuan serah-terima dapat berisi banyak jenis alat.
- Project, penerima, nomor BAST/dokumen, tanggal, dan keperluan cukup diisi satu kali.
- User menambahkan alat satu per satu ke daftar sebelum diajukan.
- Qty setiap alat dapat diedit/hapus sebelum submit.
- Stok dicek saat pengajuan dan dicek ulang saat approval.
- Admin melakukan **1 approval untuk seluruh daftar alat**.
- Approval berjalan dalam satu transaksi database: bila satu alat stoknya tidak cukup, seluruh approval dibatalkan sehingga tidak terjadi stok setengah terpotong.
- Setelah approval, transaksi OUT dibuat otomatis untuk setiap alat.
- Pengembalian dapat dilakukan sekaligus untuk seluruh alat dalam satu pengajuan.
- Histori serah-terima versi lama dimigrasikan otomatis menjadi batch satu alat sehingga data lama tetap tampil.
- Tetap menggunakan PostgreSQL/Supabase dan kompatibel dengan Back4App yang sudah terpasang.

## File yang berubah
- `server.js`
- `public/index.html`

## Cara update
1. Upload/replace `server.js` di repository GitHub.
2. Upload/replace `public/index.html`.
3. Commit changes.
4. Back4App → **Deploy latest commit**.
5. Tunggu status **Ready / Available**.

Tidak perlu mengubah `DATABASE_URL`, `JWT_SECRET`, Dockerfile, atau package.json.
