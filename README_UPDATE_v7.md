# GAJA Stock Control PRO v7 – Serialized Asset Inventory

Upgrade inventaris alat kerja untuk PT Graha Adhi Jaya Abadi.

## Fitur baru v7
- Satu jenis alat dapat memiliki banyak unit fisik dengan kode aset berbeda.
- Contoh: Gerinda Tangan = 5 unit dengan kode GRD-001, GRD-002, GRD-003, GRD-004, GRD-005.
- Input massal beberapa unit sekaligus.
- Kode dapat dibuat otomatis dari prefix atau dimasukkan manual satu per baris.
- Rekap inventaris per jenis alat menampilkan Total Aset, Di Gudang, Project/Dipinjam, Maintenance/Rusak, dan daftar kode unit.
- Setiap unit berkode unik tetap memiliki QR, status, lokasi, kondisi, project, holder, dan histori sendiri.
- Serah terima batch tetap bekerja; untuk aset berkode unik setiap kode dipilih sebagai unit fisik yang spesifik.
- Item lama tetap kompatibel sebagai mode QUANTITY.

## Cara update aplikasi online
1. Upload `server.js` dan `public/index.html` dari paket update ke repository GitHub yang sama.
2. Commit changes.
3. Back4App -> Deploy latest commit.
4. DATABASE_URL dan JWT_SECRET tidak perlu diubah.

## Rekomendasi penggunaan
- Power tools / alat bernilai: gunakan `Tambah Beberapa Unit` (SERIALIZED).
- Consumable / bahan habis pakai: gunakan `Tambah Item Biasa` (QUANTITY).

## Contoh
Jenis: Gerinda Tangan 4 inch
Kategori: Power Tools
Merk/Tipe: Bosch GWS 750
Jumlah: 5
Prefix: GRD
Kode otomatis: GRD-001 s.d. GRD-005
