/**
 * Terjemahan Inggris pesan error API. Kunci = pesan Indonesia di kode dengan setiap bagian dinamis (`${…}` di
 * template, `%` di RAISE SQL) ditulis `{}`; nilai memakai `{0}`, `{1}`, … untuk bagian dinamis sesuai urutan.
 * Tes `error-i18n-coverage` memastikan setiap pesan di kode punya entri di sini (atau di error-i18n.ts).
 */
export const MESSAGES_EN: Record<string, string> = {
  // ---- Umum & platform ----
  "Struktur perusahaan tidak boleh melingkar": "The company structure cannot be circular",
  "IDR adalah mata uang dasar (kurs selalu 1)": "IDR is the base currency (its rate is always 1)",
  "Belum ada mata uang yang dipilih": "No currency selected",
  "Mata uang tidak dikenal": "Unknown currency",
  "Kategori tidak ditemukan": "Category not found",
  "Satuan tidak ditemukan": "Unit of measure not found",
  "Satuan harus sekategori dengan satuan produk": "The unit must be in the same category as the product unit",
  "Maksimal {} baris per impor": "At most {0} rows per import",
  'Tanggal tidak valid: "{}"': 'Invalid date: "{0}"',
  "Jumlah tidak valid": "Invalid amount",
  "Tanggal akhir sebelum tanggal awal": "End date is before start date",
  "Tanggal awal setelah tanggal akhir": "Start date is after end date",
  "Tidak punya akses ke salah satu perusahaan": "No access to one of the companies",
  "Pilih minimal satu perusahaan": "Select at least one company",
  "Slug 3-40 karakter: huruf kecil, angka, tanda hubung":
    "Slug must be 3-40 characters: lowercase letters, digits, hyphens",
  "Kode 2FA harus 6 digit": "The 2FA code must be 6 digits",
  "Huruf/angka saja": "Letters and digits only",
  "Huruf besar, angka, atau -": "Uppercase letters, digits, or -",
  "Huruf besar, angka, atau _": "Uppercase letters, digits, or _",
  "Minimal dua baris": "At least two lines",
  "Minimal satu baris": "At least one line",
  "Minimal satu produk": "At least one product",
  "Zona waktu tidak dikenal (contoh: Asia/Jakarta)": "Unknown time zone (e.g. Asia/Jakarta)",
  "Undangan tidak valid atau kedaluwarsa": "Invalid or expired invitation",
  "Pilih peran bawaan untuk user yang dibuat otomatis":
    "Choose a default role for automatically created users",
  "Penyedia identitas menolak login ({})": "The identity provider rejected the sign-in ({0})",
  "ID token tidak valid: {}": "Invalid ID token: {0}",
  "ID token tidak valid (nonce)": "Invalid ID token (nonce)",
  "Discovery OpenID {} gagal: {}": "OpenID discovery for {0} failed: {1}",
  "Dokumen discovery OpenID tidak lengkap": "The OpenID discovery document is incomplete",
  "Sertifikat IdP tidak valid": "Invalid IdP certificate",
  "URL SSO IdP tidak valid": "Invalid IdP SSO URL",
  "Respons SAML tidak valid: {}": "Invalid SAML response: {0}",
  "Respons SAML tidak valid: tanpa assertion": "Invalid SAML response: no assertion",

  // ---- Langganan ----
  "Token callback tidak valid": "Invalid callback token",
  "Paket ini tidak bisa dipesan sendiri; hubungi tim kami":
    "This plan cannot be ordered online; please contact us",
  "Paket {} maksimal {} pengguna aktif. Tingkatkan paket Anda.":
    "The {0} plan allows at most {1} active users. Upgrade your plan.",
  "Paket {} maksimal {} perusahaan. Tingkatkan paket Anda.":
    "The {0} plan allows at most {1} companies. Upgrade your plan.",
  "Paket {} maksimal {} pengguna; saat ini ada {} pengguna aktif":
    "The {0} plan allows at most {1} users; there are currently {2} active users",
  "Paket {} maksimal {} perusahaan; saat ini ada {}":
    "The {0} plan allows at most {1} companies; there are currently {2}",
  "Tagihan tidak terbuka": "The bill is not open",
  "Tagihan sudah dibatalkan": "The bill is already cancelled",
  "Hanya langganan aktif yang bisa dibatalkan/dilanjutkan":
    "Only active subscriptions can be cancelled or resumed",

  // ---- Produk & varian ----
  "Varian tidak bisa punya varian lagi": "A variant cannot have its own variants",
  "Nilai atribut pada kelompok {} tidak ditemukan": "Attribute value in group {0} not found",
  "Setiap kelompok harus berisi nilai dari satu atribut":
    "Each group must contain values of a single attribute",
  "Atribut yang sama dipilih lebih dari sekali": "The same attribute was selected more than once",
  "Maksimal 500 varian sekali buat": "At most 500 variants at a time",
  "Pilih minimal satu atribut": "Select at least one attribute",

  // ---- CRM & penjualan ----
  "Peluang tidak ditemukan": "Opportunity not found",
  "Aktivitas tidak ditemukan": "Activity not found",
  "Lead tidak ditemukan": "Lead not found",
  "Gunakan aksi 'Tandai menang' untuk tahap menang": "Use the 'Mark as won' action for the won stage",
  "Pulihkan lead yang kalah sebelum memindah tahap": "Restore the lost lead before moving its stage",
  "Lead sudah punya penawaran; tandai kalah alih-alih menghapus":
    "The lead already has quotations; mark it as lost instead of deleting it",
  "Alasan kalah tidak ditemukan": "Lost reason not found",
  "Hanya lead terbuka yang bisa dikonversi": "Only open leads can be converted",
  "Pilih pelanggan": "Choose a customer",
  "Tahap tidak ditemukan": "Stage not found",
  "Tahap masih dipakai lead; pindahkan lead-nya dulu": "The stage still has leads; move them first",
  "Tim penjualan tidak ditemukan": "Sales team not found",
  "Termin pembayaran tidak ditemukan": "Payment term not found",
  "Hanya penawaran (draft/terkirim) yang bisa diubah": "Only quotations (draft/sent) can be edited",
  "Hanya penawaran draft atau pesanan batal yang bisa dihapus":
    "Only draft quotations or cancelled orders can be deleted",
  "Pesanan sudah punya faktur dan tidak bisa dihapus": "The order already has invoices and cannot be deleted",
  "Pesanan sudah punya pengiriman": "The order already has deliveries",
  "Pesanan batal tidak bisa dikirim": "A cancelled order cannot be sent",
  "Pelanggan belum punya email; isi alamat tujuan": "The customer has no email; enter a recipient address",
  "Hanya penawaran yang bisa dikonfirmasi": "Only quotations can be confirmed",
  "Pesanan harus punya minimal satu baris dengan kuantitas":
    "The order needs at least one line with a quantity",
  "Hapus draft faktur pesanan ini terlebih dahulu": "Delete this order's draft invoices first",
  "Pesanan sudah ditagih; buat nota kredit sebelum membatalkan":
    "The order is already invoiced; issue a credit note before cancelling",
  "Barang sudah dikirim; buat retur sebelum membatalkan":
    "Goods were already delivered; create a return before cancelling",
  "Hanya pesanan batal yang bisa dijadikan draft": "Only cancelled orders can be reset to draft",
  "Konfirmasi pesanan sebelum membuat faktur": "Confirm the order before invoicing",
  "Akun uang muka pelanggan belum diatur di pengaturan akuntansi":
    "The customer down payment account is not set in the accounting settings",
  "Tidak ada kuantitas yang perlu ditagih": "Nothing to invoice",
  "Nilai pesanan nol": "The order total is zero",
  "Uang muka melebihi nilai pesanan sebelum pajak": "The down payment exceeds the order total before tax",
  "Total faktur tidak positif (uang muka melebihi sisa tagihan)":
    "The invoice total is not positive (down payments exceed the remaining amount)",
  "Pajak PPnBM {}% belum ada di perusahaan ini (buat di Akuntansi → Pajak, jenis PPnBM)":
    "There is no {0}% luxury sales tax (PPnBM) in this company (create it under Accounting → Taxes, type PPnBM)",
  "Tanggal berlaku sebelum tanggal penawaran": "The validity date is before the quotation date",
  "Dropship hanya untuk barang": "Dropship is only for goods",
  "Pajak tidak ditemukan atau bukan pajak penjualan": "Tax not found or not a sales tax",
  "Pilih penjual atau tim, tidak keduanya": "Choose a salesperson or a team, not both",
  "Penawaran ini tidak bisa disetujui (bukan penawaran terkirim atau sudah kedaluwarsa)":
    "This quotation cannot be accepted (not a sent quotation, or it has expired)",
  "Penawaran tidak punya penanggung jawab; hubungi penjual":
    "The quotation has no responsible user; contact the seller",
  "{} ditandai dropship tetapi belum punya pemasok (atur di harga pemasok produk)":
    "{0} is marked for dropship but has no vendor (set it in the product's vendor prices)",

  // ---- Portal pelanggan ----
  "Masuk ke portal terlebih dahulu": "Sign in to the portal first",
  "Portal hanya untuk pelanggan": "The portal is for customers only",
  "Email sudah dipakai akun portal pelanggan lain":
    "The email is already used by another customer portal account",
  "Sesi portal tidak valid atau kedaluwarsa": "Invalid or expired portal session",

  // ---- Pembelian ----
  "Hanya RFQ (draft/terkirim) yang bisa diubah": "Only RFQs (draft/sent) can be edited",
  "Hanya RFQ draft atau PO batal yang bisa dihapus": "Only draft RFQs or cancelled POs can be deleted",
  "PO sudah punya penerimaan barang": "The PO already has receipts",
  "PO batal tidak bisa dikirim": "A cancelled PO cannot be sent",
  "Pemasok belum punya email; isi alamat tujuan": "The vendor has no email; enter a recipient address",
  "Hanya RFQ yang bisa dikonfirmasi": "Only RFQs can be confirmed",
  "PO harus punya minimal satu baris dengan kuantitas": "The PO needs at least one line with a quantity",
  "PO tidak sedang menunggu persetujuan": "The PO is not waiting for approval",
  "Barang sudah diterima; buat retur terlebih dahulu": "Goods were already received; create a return first",
  "PO sudah ditagih; batalkan tagihannya terlebih dahulu": "The PO is already billed; cancel its bills first",
  "Hapus draft tagihan PO ini terlebih dahulu": "Delete this PO's draft bills first",
  "Hanya PO batal yang bisa dijadikan draft": "Only cancelled POs can be reset to draft",
  "Konfirmasi PO sebelum membuat tagihan": "Confirm the PO before billing",
  "Tidak ada kuantitas yang perlu ditagih (barang belum diterima?)":
    "Nothing to bill (goods not received yet?)",
  "Akun Barang Diterima Belum Ditagih belum diatur": "The goods received not invoiced account is not set",
  "Pesanan pembelian tidak ditemukan": "Purchase order not found",
  "Pajak tidak ditemukan atau bukan pajak pembelian": "Tax not found or not a purchase tax",

  // ---- Persediaan ----
  "Lokasi persediaan perusahaan belum disiapkan": "The company's stock locations are not set up",
  "Lokasi induk (view) tidak bisa menyimpan stok": "A parent (view) location cannot hold stock",
  "Transfer internal harus antar lokasi internal": "An internal transfer must be between internal locations",
  "Lokasi asal dan tujuan sama": "Source and destination locations are the same",
  "Produk jasa tidak memiliki stok": "Service products have no stock",
  "Hanya transfer draft yang bisa diubah": "Only draft transfers can be edited",
  "Transfer dari pesanan diubah lewat pesanannya":
    "Transfers created from an order are edited through the order",
  "Hanya transfer draft yang bisa dikonfirmasi": "Only draft transfers can be confirmed",
  "Hanya transfer siap yang punya cadangan": "Only ready transfers have reservations",
  "Transfer selesai tidak bisa dibatalkan; buat retur":
    "A done transfer cannot be cancelled; create a return",
  "Hanya transfer draft/batal yang bisa dihapus": "Only draft or cancelled transfers can be deleted",
  "Transfer dari pesanan tidak bisa dihapus; batalkan saja":
    "Transfers from an order cannot be deleted; cancel them",
  "Transfer sudah selesai atau dibatalkan": "The transfer is already done or cancelled",
  "Baris transfer tidak ditemukan": "Transfer line not found",
  "Retur melebihi kuantitas": "The return exceeds the quantity",
  "Isi kuantitas yang dipindahkan minimal satu baris": "Enter the moved quantity on at least one line",
  "Stok {} di {} tidak cukup: yang belum dicadangkan transfer lain {}, dibutuhkan {}":
    "Not enough {0} in {1}: {2} not reserved by other transfers, {3} needed",
  "Hanya transfer selesai yang bisa diretur": "Only done transfers can be returned",
  "Dropship diretur lewat nota kredit pelanggan dan retur ke pemasok secara manual":
    "Dropship is returned through a customer credit note and a manual vendor return",
  "Transfer internal dikembalikan dengan transfer internal baru":
    "Internal transfers are reversed with a new internal transfer",
  "Baris tidak ditemukan pada transfer ini": "Line not found on this transfer",
  "Melebihi kuantitas yang bisa diretur": "Exceeds the returnable quantity",
  "Pilih lokasi stok internal": "Choose an internal stock location",
  "Produk stok tidak ditemukan": "Stockable product not found",
  "Produk ini wajib lot/serial": "This product requires a lot/serial number",
  "Nomor serial hanya boleh berjumlah 0 atau 1": "A serial number quantity must be 0 or 1",
  "Akun persediaan belum diatur di pengaturan akuntansi":
    "The inventory account is not set in the accounting settings",
  "Stok {} di {} tidak cukup (tersedia {}, dibutuhkan {})":
    "Not enough {0} in {1} ({2} available, {3} needed)",
  "Nomor serial {} sudah ada di {}": "Serial number for {0} already exists in {1}",
  "Produk ini tidak memakai lot/serial": "This product does not use lot/serial numbers",
  "Isi nomor {} untuk {}": "Enter the {0} number for {1}",
  "Jumlah per lot harus sama dengan kuantitas dipindahkan":
    "The quantities per lot must add up to the moved quantity",
  "Setiap nomor serial berjumlah 1": "Each serial number has a quantity of 1",
  "Lot tidak ditemukan untuk produk ini": "Lot not found for this product",
  "Pilih lot yang tersedia": "Choose an available lot",
  "Lot/serial ganda": "Duplicate lot/serial number",
  "Perusahaan belum punya gudang": "The company has no warehouse",
  "Lokasi induk harus lokasi gudang": "The parent location must be a warehouse location",
  "Lokasi sistem tidak bisa diubah": "System locations cannot be changed",
  "Lokasi masih berisi stok": "The location still holds stock",
  "Maksimum harus ≥ minimum": "Maximum must be ≥ minimum",
  "Hanya transfer siap yang bisa dicadangkan": "Only ready transfers can be reserved",
  "Lot tidak ditemukan": "Lot not found",

  // ---- Akuntansi ----
  "Akuntansi belum disiapkan untuk perusahaan ini (POST /accounting/setup)":
    "Accounting is not set up for this company (POST /accounting/setup)",
  "Akuntansi belum disiapkan untuk perusahaan ini": "Accounting is not set up for this company",
  "Jurnal harus bertipe {}": "The journal must be of type {0}",
  "Unit bisnis tidak ditemukan": "Business unit not found",
  "Cabang tidak ditemukan di perusahaan ini": "Branch not found in this company",
  "Hanya baris dari entri yang sudah diposting": "Only lines of posted entries",
  "Akun tidak dapat direkonsiliasi": "The account cannot be reconciled",
  "Baris harus pada akun, partner, dan perusahaan yang sama":
    "Lines must have the same account, partner, and company",
  "Akun laba/rugi selisih kurs belum diatur di pengaturan akuntansi":
    "The exchange gain/loss accounts are not set in the accounting settings",
  "Aset yang sudah berjalan tidak bisa diubah": "A running asset cannot be changed",
  "Tanggal mulai penyusutan tidak boleh sebelum tanggal perolehan":
    "The depreciation start date cannot be before the acquisition date",
  "Aset tidak ditemukan": "Asset not found",
  "Aset sudah dikonfirmasi": "The asset is already confirmed",
  "Hanya aset yang sudah dikonfirmasi dan belum dilepas yang bisa dilepas":
    "Only confirmed assets that are not yet disposed can be disposed",
  "Tanggal pelepasan tidak boleh sebelum tanggal perolehan":
    "The disposal date cannot be before the acquisition date",
  "Akun laba/rugi pelepasan aset belum diatur di pengaturan akuntansi":
    "The asset disposal gain/loss account is not set in the accounting settings",
  "Penjualan aset memerlukan pembeli dan harga jual": "An asset sale needs a buyer and a sale price",
  "Penjualan memerlukan pembeli dan harga jual": "A sale needs a buyer and a sale price",
  "Hanya aset draft yang bisa dihapus": "Only draft assets can be deleted",
  "Periode sudah dikunci sampai {}; tahun ini kemungkinan sudah ditutup":
    "The period is locked until {0}; this year is probably already closed",
  "Tahun fiskal {} sudah ditutup": "Fiscal year {0} is already closed",
  "Masih ada {} entri draft di tahun fiskal ini; posting atau hapus dulu":
    "There are still {0} draft entries in this fiscal year; post or delete them first",
  "Tidak ada saldo laba rugi untuk ditutup di tahun fiskal ini":
    "There is no profit or loss to close in this fiscal year",
  "Jenis dokumen tidak bisa diubah": "The document type cannot be changed",
  "Dokumen ini adalah faktur/tagihan": "This document is an invoice/bill",
  "Entri tidak seimbang: debit {}, kredit {}": "Entry is not balanced: debit {0}, credit {1}",
  "Periode sudah dikunci sampai {}; ubah tanggal entri atau buka kunci periode":
    "The period is locked until {0}; change the entry date or unlock the period",
  "Hanya entri yang sudah diposting yang bisa dibalik": "Only posted entries can be reversed",
  "Entri ini sudah pernah dibalik": "This entry has already been reversed",
  "Entri sudah diposting; gunakan pembalikan untuk koreksi":
    "The entry is posted; use a reversal to correct it",
  "Isi debit atau kredit, tidak keduanya": "Enter a debit or a credit, not both",
  "Debit atau kredit harus diisi": "Enter a debit or a credit",
  "Pajak tidak ditemukan atau tidak sesuai jenis dokumen":
    "Tax not found or not valid for this document type",
  "Pilih akun (jurnal tidak punya akun bawaan)": "Choose an account (the journal has no default account)",
  "Total dokumen tidak boleh nol": "The document total cannot be zero",
  "Anggaran tidak ditemukan": "Budget not found",
  "Faktur/tagihan tidak ditemukan, belum diposting, atau partner berbeda":
    "Invoice/bill not found, not posted, or for another partner",
  "Jenis dokumen tidak sesuai arah pembayaran": "The document type does not match the payment direction",
  "Baris pembayaran tidak ditemukan": "Payment line not found",
  "Parameter accountId wajib diisi": "The accountId parameter is required",
  "Mutasi bank tidak ditemukan": "Bank statement not found",
  "Tidak ada transaksi di file": "No transactions in the file",
  "Baris jurnal sudah lunas atau tidak sesuai arah mutasi":
    "The journal item is already settled or does not match the statement direction",
  "Sisa {} belum dialokasikan; pilih akun untuk sisanya":
    "{0} remains unallocated; choose an account for the rest",
  "Baris mutasi belum direkonsiliasi": "The statement line is not reconciled",
  "Batalkan rekonsiliasi semua baris sebelum menghapus mutasi":
    "Undo the reconciliation of all lines before deleting the statement",
  "Baris mutasi tidak ditemukan": "Statement line not found",
  "Baris mutasi sudah direkonsiliasi": "The statement line is already reconciled",
  "Kurs {} per {} belum tersedia: {}": "{0} rate as of {1} is not available: {2}",
  "Revaluasi kurs per {} sudah diposting": "The exchange revaluation as of {0} is already posted",
  "Akun selisih kurs belum terealisasi belum diatur di pengaturan akuntansi":
    "The unrealized exchange difference accounts are not set in the accounting settings",
  "Tidak ada saldo valas yang perlu dinilai ulang": "No foreign currency balances to revalue",
  "Jurnal kas/bank belum punya akun": "The cash/bank journal has no account",
  "Saldo awal sudah diposting; koreksi lewat jurnal umum":
    "The opening balance is already posted; correct it with a general journal entry",
  "Saldo awal minimal dua baris bernilai": "The opening balance needs at least two lines with amounts",

  // ---- Konsolidasi ----
  "Akun grup masih dipakai pemetaan; nonaktifkan saja":
    "The group account is still mapped; deactivate it instead",
  "Sebagian akun bukan milik perusahaan ini": "Some accounts do not belong to this company",
  "Kurs {} terhadap {} belum tersedia ({}); isi Kurs Harian atau kurs manual":
    "{0} rate against {1} is not available ({2}); enter a daily rate or a manual rate",
  "Konsolidasi final tidak bisa dihitung ulang": "A final consolidation cannot be recomputed",
  "Jurnal kosong": "The entry is empty",
  "Perusahaan di luar lingkup konsolidasi": "The company is outside the consolidation scope",
  "Jurnal otomatis diatur lewat Hitung ulang": "Automatic entries are managed through Recompute",
  "Kertas kerja tidak seimbang (selisih {})": "The worksheet is not balanced (difference {0})",
  "Konsolidasi final tidak bisa dihapus": "A final consolidation cannot be deleted",
  "Proses konsolidasi tidak ditemukan": "Consolidation run not found",
  "Tidak punya akses ke salah satu perusahaan dalam lingkup konsolidasi":
    "No access to one of the companies in the consolidation scope",

  // ---- SDM & payroll ----
  "Akun Anda belum terhubung dengan data karyawan di perusahaan ini":
    "Your account is not linked to an employee record in this company",
  "Karyawan sudah punya slip gaji; nonaktifkan saja": "The employee already has payslips; deactivate instead",
  "Departemen tidak ditemukan di perusahaan ini": "Department not found in this company",
  "Jadwal kerja tidak ditemukan di perusahaan ini": "Work schedule not found in this company",
  "Jabatan tidak ditemukan": "Job position not found",
  "Atasan tidak boleh diri sendiri": "An employee cannot be their own manager",
  "Atasan tidak ditemukan di perusahaan ini": "Manager not found in this company",
  "Tanggal keluar sebelum tanggal masuk": "The resignation date is before the join date",
  "Tanggal berakhir sebelum tanggal masuk": "The end date is before the join date",
  "Pengajuan sudah diproses": "The request has already been processed",
  "Tidak bisa menyetujui pengajuan sendiri": "You cannot approve your own request",
  "Hanya bisa mengajukan cuti untuk diri sendiri": "You can only request leave for yourself",
  "Jenis cuti tidak ditemukan": "Leave type not found",
  "Rentang cuti tidak mencakup hari kerja": "The leave period contains no working days",
  "Rentang cuti maksimal satu tahun": "The leave period can be at most one year",
  "Data libur nasional {} belum tersedia — impor dari berkas atau tambahkan manual":
    "National holidays for {0} are not available yet — import a file or add them manually",
  "Sudah ada pengajuan cuti pada tanggal tersebut": "There is already a leave request on those dates",
  "Saldo {} tidak cukup (sisa {} hari, diminta {})": "Not enough {0} balance ({1} days left, {2} requested)",
  "Tidak bisa membatalkan cuti orang lain": "You cannot cancel someone else's leave",
  "Pengajuan sudah ditutup": "The request is already closed",
  "Lembur sudah dibayar lewat slip gaji": "The overtime has already been paid on a payslip",
  "Hasil kerja sudah dibayar lewat slip gaji": "The piece work has already been paid on a payslip",
  "Kontrak selesai/batal tidak bisa diubah": "A finished or cancelled contract cannot be changed",
  "Karyawan kontrak tidak bisa diganti": "The contract's employee cannot be changed",
  "Hanya kontrak draft yang bisa dimulai": "Only draft contracts can be started",
  "Karyawan masih punya kontrak berjalan ({}); akhiri dulu":
    "The employee still has a running contract ({0}); end it first",
  "Hanya kontrak berjalan yang bisa diakhiri": "Only running contracts can be ended",
  "Tanggal berakhir sebelum mulai": "The end date is before the start date",
  "Hanya kontrak draft yang bisa dihapus": "Only draft contracts can be deleted",
  "PKWT wajib punya tanggal berakhir": "A fixed-term contract (PKWT) needs an end date",
  "Komponen ganda": "Duplicate component",
  "Anda sudah absen masuk; absen pulang dulu": "You have already checked in; check out first",
  "Belum absen masuk": "Not checked in yet",
  "Jam pulang sebelum jam masuk": "Check-out time is before check-in time",
  "Tanggal selesai sebelum mulai": "The end date is before the start date",
  "Kontrak tidak boleh mulai sebelum tanggal masuk karyawan ({})":
    "The contract cannot start before the employee's join date ({0})",
  "Kontrak tidak boleh mulai setelah tanggal keluar karyawan ({})":
    "The contract cannot start after the employee's leave date ({0})",
  "Kontrak tidak boleh berakhir setelah tanggal keluar karyawan ({})":
    "The contract cannot end after the employee's leave date ({0})",
  "Kontrak {} mulai {}, sebelum tanggal masuk baru; ubah kontraknya dulu":
    "Contract {0} starts {1}, before the new join date; change the contract first",
  "Kontrak {} mulai {}, setelah tanggal keluar; batalkan/hapus kontraknya dulu":
    "Contract {0} starts {1}, after the leave date; cancel/delete the contract first",
  "Kontrak {} berakhir {}, sebelum tanggal masuk baru; ubah kontraknya dulu":
    "Contract {0} ends {1}, before the new join date; change the contract first",
  "Seluruh kuota posisi ini sudah diajukan lewat FPK":
    "The whole quota of this position has already been requested",
  "Hanya FPK draft yang bisa diubah": "Only draft hiring requests can be edited",
  "Hanya FPK draft yang bisa dihapus": "Only draft hiring requests can be deleted",
  "FPK sudah diajukan": "The hiring request has already been submitted",
  "FPK sudah selesai": "The hiring request is already closed",
  "Lowongan dari FPK ini sudah dibuka; tutup lowongan di menu Rekrutmen":
    "A job opening from this hiring request is already open; close it in Recruitment",
  "Posisi terisi tidak perlu FPK": "Existing positions do not need a hiring request",
  "FPK tidak ditemukan": "Hiring request not found",
  "Hanya HR (hr.manage) atau kepala departemen yang bisa mengajukan FPK":
    "Only HR (hr.manage) or the department head can submit hiring requests",
  "Baris MPP berbeda departemen/jabatan": "The manpower plan line has a different department/job",
  "Melebihi sisa kuota MPP ({} orang); ajukan FPK di luar MPP untuk kelebihannya":
    "Exceeds the remaining manpower plan quota ({0}); submit an unplanned hiring request for the rest",
  "Lowongan dari MPP dibuka lewat Usulan Penambahan Karyawan (FPK): ajukan FPK dari baris ini, lalu buka lowongan setelah disetujui":
    "Openings from the manpower plan go through a hiring request: submit one from this line, then open the job once approved",
  "Posisi yang sudah diajukan lewat FPK tidak bisa dihapus dari MPP; batalkan FPK-nya dulu":
    "Positions with hiring requests cannot be removed from the plan; cancel the requests first",
  "Sudah diajukan lewat FPK {} orang; jumlah tidak boleh kurang dari itu":
    "{0} already requested through hiring requests; the quantity cannot be lower",
  "Pelamar belum menerima penawaran kerja; buat & kirim penawaran dulu":
    "The applicant has not accepted a job offer; create and send an offer first",
  "Kuota lowongan ({} orang) sudah terpenuhi; ajukan FPK baru untuk tambahan":
    "The opening's quota ({0}) is already filled; submit a new hiring request for more",
  "Pelamar belum diproses kontraknya": "The applicant has not been hired yet",
  "Karyawan sudah aktif (kontrak sudah dimulai); gunakan proses offboarding":
    "The employee is already active (contract started); use offboarding instead",
  "Gaji maksimal di bawah gaji minimal": "Maximum wage is below the minimum wage",
  "Pilih karyawan yang digantikan": "Choose the employee being replaced",
  "Minimal 1 orang": "At least 1 person",
  "Isi alasan kebutuhan": "Fill in the reason",
  "Maksimal 2 desimal": "At most 2 decimal places",
  "Jam lembur maksimal {} jam sesuai pengajuan/hasil absensi":
    "Overtime can be at most {0} hours, as requested/computed from attendance",
  "Payroll belum disiapkan (pasang bagan akun standar di Pengaturan Akuntansi)":
    "Payroll is not set up (install the standard chart of accounts in Accounting Settings)",
  "Payroll belum disiapkan": "Payroll is not set up",
  "Payroll untuk bulan ini sudah ada": "A payroll for this month already exists",
  "Payroll yang sudah diposting tidak bisa dihitung ulang": "A posted payroll cannot be recomputed",
  "Tidak ada slip gaji": "No payslips",
  "Akun piutang karyawan belum diatur di pengaturan payroll":
    "The employee receivable account is not set in the payroll settings",
  "Posting payroll sebelum membayar": "Post the payroll before paying",
  "Tidak ada gaji bersih yang perlu dibayar": "No net pay to pay",
  "Payroll yang sudah diposting tidak bisa dibatalkan (balik jurnalnya)":
    "A posted payroll cannot be cancelled (reverse its entry)",
  "Slip gaji tidak ditemukan": "Payslip not found",
  "Payroll tidak ditemukan": "Payroll not found",
  "Cicilan melebihi pokok pinjaman": "The installment exceeds the loan principal",
  "Hanya pinjaman draft yang bisa dicairkan": "Only draft loans can be disbursed",
  "Pinjaman sudah selesai atau batal": "The loan is already finished or cancelled",
  "Pinjaman sudah dicicil; tidak bisa dibatalkan": "The loan already has repayments; it cannot be cancelled",
  "Tidak ada hak akhir yang perlu dibayar": "No final entitlements to pay",
  "Karyawan belum punya kontrak": "The employee has no contract",

  // ---- Pajak ----
  "Perusahaan belum ditandai PKP; faktur pajak hanya untuk PKP":
    "The company is not marked as a VAT-registered business (PKP); tax invoices are for PKP only",
  "Hanya faktur pajak draft yang bisa diubah": "Only draft tax invoices can be edited",
  "Faktur pajak {} berstatus {}": "Tax invoice {0} has status {1}",
  "Faktur pajak {} adalah faktur pengganti: buat lewat Coretax (Faktur Keluaran → pilih faktur {} → Ganti), lalu catat nomornya di sini. Impor XML Coretax hanya untuk faktur normal.":
    "Tax invoice {0} is a replacement invoice: create it in Coretax (Output Tax Invoices → select invoice {1} → Replace), then record its number here. Coretax XML import is for normal invoices only.",
  "Faktur pajak sudah dibatalkan": "The tax invoice is already cancelled",
  "Nomor faktur {} sudah dipakai": "Invoice number {0} is already used",
  "Hanya faktur pajak yang sudah terbit (bernomor) yang bisa diganti":
    "Only issued (numbered) tax invoices can be replaced",
  "Faktur pengganti untuk faktur ini sudah ada": "A replacement for this invoice already exists",
  "Rentang NSFP bertumpang tindih dengan rentang yang sudah ada": "The NSFP range overlaps an existing range",
  "Rentang NSFP sudah terpakai": "The NSFP range is already in use",
  "Faktur yang diganti oleh {} tidak punya NSFP (bukan e-Faktur lama) — buat penggantinya di Coretax":
    "The invoice replaced by {0} has no NSFP (not a legacy e-Faktur) — create its replacement in Coretax",
  "NSFP tahun {} habis atau belum didaftarkan": "NSFP numbers for {0} are used up or not registered",
  "Faktur masukan tidak ditemukan": "Input tax invoice not found",
  "Faktur {} hanya bisa dikreditkan pada masa {}/{} s.d. 3 masa berikutnya":
    "Invoice {0} can only be credited in period {1}/{2} up to the next 3 periods",
  "Hanya nota retur draft yang bisa diubah": "Only draft return notes can be edited",
  "Nota retur sudah dibatalkan": "The return note is already cancelled",
  "Pilih faktur pajak masukan yang diretur dulu": "Choose the returned input tax invoice first",
  "Hanya bukti potong draft yang bisa diubah": "Only draft withholding slips can be edited",
  "Ekspor BPPU, BPMP, BP21, dan BPA1 dalam berkas terpisah":
    "Export BPPU, BPMP, BP21 and BPA1 in separate files",
  "Sudah ada parameter yang berlaku mulai tanggal ini": "A parameter already takes effect on this date",
  "Parameter payroll tidak ditemukan": "Payroll parameter not found",
  "Kode objek pajak, mis. 21-100-03": "Tax object code, e.g. 21-100-03",
  "Minimal satu parameter payroll harus ada": "At least one payroll parameter must remain",
  "Bukti potong sudah dibatalkan": "The withholding slip is already cancelled",
  "Lengkapi NPWP perusahaan (Pengaturan → Perusahaan) terlebih dahulu":
    "Complete the company NPWP (Settings → Company) first",
  "Tanggal faktur tidak valid": "Invalid invoice date",
  "NPWP penjual tidak valid": "Invalid seller NPWP",
  "Kode tempat usaha 6 digit (000000 = pusat)":
    "The business location code is 6 digits (000000 = head office)",
  "Kode satuan Coretax, mis. UM.0021": "Coretax unit code, e.g. UM.0021",
  "Kode objek pajak, mis. 24-104-14": "Tax object code, e.g. 24-104-14",

  // ---- Trigger database ----
  "Baris jurnal pada entri yang sudah diposting tidak bisa diubah":
    "Journal items of a posted entry cannot be changed",
  "Entri jurnal tidak seimbang (debit {}, kredit {}, {} baris)":
    "The journal entry is not balanced (debit {0}, credit {1}, {2} lines)",
  "Periode sudah dikunci sampai {}; entri bertanggal {} tidak bisa diposting":
    "The period is locked until {0}; entries dated {1} cannot be posted",
  "Entri jurnal {} sudah diposting dan tidak bisa dihapus":
    "Journal entry {0} is posted and cannot be deleted",
  "Entri jurnal {} sudah diposting dan tidak bisa diubah":
    "Journal entry {0} is posted and cannot be changed",
  // Payroll lanjutan
  "Tanggal transfer tidak boleh di masa depan": "The transfer date cannot be in the future",
  "Upah maksimum di bawah upah minimum": "The maximum wage is below the minimum wage",
  "Gaji pokok golongan tidak boleh di bawah upah minimum":
    "The grade base wage cannot be below the minimum wage",
  "Gaji pokok golongan tidak boleh di atas upah maksimum":
    "The grade base wage cannot be above the maximum wage",
  "Gaji pokok wajib diisi: golongan karyawan belum punya gaji pokok standar":
    "Base wage is required: the employee's grade has no standard base wage",
  "Gaji pokok wajib diisi": "Base wage is required",
  "Upah wajib diisi": "Wage is required",
  "Golongan belum punya gaji pokok standar": "The grade has no standard base wage",
  "Golongan upah tidak ditemukan": "Salary grade not found",
  "Payroll sudah diajukan untuk persetujuan": "The payroll has already been submitted for approval",
  "Mutasi sudah diajukan untuk persetujuan": "The movement has already been submitted for approval",
  "Penawaran sudah diajukan untuk persetujuan": "The offer has already been submitted for approval",
  "Hanya penawaran draft yang bisa diajukan": "Only draft offers can be submitted",
  "Menunggu persetujuan; belum bisa diproses": "Waiting for approval; cannot be processed yet",
  "Ajukan persetujuan terlebih dulu": "Submit for approval first",
  "Masa percobaan hanya untuk perjanjian kerja waktu tidak tertentu (PKWTT)":
    "A probation period is only allowed for permanent (PKWTT) contracts",
  "Kontrak ini tanpa masa percobaan": "This contract has no probation period",
  "Hanya kontrak berjalan yang dievaluasi": "Only running contracts can be evaluated",
  "Surat pengangkatan tersedia setelah karyawan lulus masa percobaan":
    "The appointment letter is available after the employee passes probation",
  "Data pelamar sudah dianonimkan": "The applicant data has been anonymized",
  "Pelamar sudah menjadi karyawan; data dikelola di data karyawan":
    "The applicant is already an employee; manage the data in the employee record",
  "Atur PIN slip gaji terlebih dulu": "Set your payslip PIN first",
  "Masukkan PIN slip gaji": "Enter your payslip PIN",
  "PIN slip terkunci sementara; coba lagi nanti atau minta HR mengatur ulang":
    "Payslip PIN temporarily locked; try again later or ask HR to reset it",
  "PIN lama salah": "The current PIN is wrong",
  "PIN slip salah": "Wrong payslip PIN",
  "Masa percobaan maksimal 3 bulan": "Probation is at most 3 months",
  "PIN slip harus 6 digit angka": "The payslip PIN must be 6 digits",
  "Komponen THR belum diatur di pengaturan payroll": "The THR component is not set in the payroll settings",
  "Komponen rapel belum diatur di pengaturan payroll":
    "The back-pay component is not set in the payroll settings",
  "Rekening sumber transfer gaji belum diatur di pengaturan payroll":
    "The salary transfer source account is not set in the payroll settings",
  "Posting payroll sebelum mengirim slip": "Post the payroll before sending payslips",
  "Pilih komponen tunjangan perusahaan ini": "Choose an allowance component of this company",
  "Periode akhir sebelum awal": "The end period is before the start period",
  "Nomor rekening hanya angka": "The account number may only contain digits",
  // Klaim biaya & portal
  "Klaim biaya tidak ditemukan": "Expense claim not found",
  "Pengajuan perubahan data tidak ditemukan": "Data change request not found",
  "Masih ada pengajuan perubahan data yang menunggu persetujuan":
    "A data change request is still awaiting approval",
  "Klaim belum punya baris": "The claim has no lines",
  "Klaim {} melebihi plafon tahunan (sisa Rp {}, lebih Rp {})":
    "Claim {0} exceeds the annual limit (Rp {1} left, Rp {2} over)",
  "Klaim yang sudah dibayar/dibatalkan tidak bisa dibatalkan": "Paid or cancelled claims cannot be cancelled",
  "Hanya klaim disetujui yang bisa dibayar": "Only approved claims can be paid",
  "Klaim ini dibayar lewat slip gaji berikutnya": "This claim is paid through the next payslip",
  "Bukti klaim tidak ditemukan": "Claim receipt not found",
  "Hanya klaim draft yang bisa diubah": "Only draft claims can be changed",
  "Karyawan klaim tidak bisa diganti": "The claim's employee cannot be changed",
  "Pilih karyawan": "Choose an employee",
  "Kategori klaim tidak ditemukan": "Expense category not found",
  "Klaim {} sudah berubah; hitung ulang payroll": "Claim {0} has changed; recompute the payroll",
  "Berkas harus PDF, JPG, atau PNG": "The file must be a PDF, JPG or PNG",
  "Isi minimal satu data yang diubah": "Fill in at least one field to change",
  "Berkas tidak valid": "Invalid file",
  "Berkas maksimal {} MB": "Files may be at most {0} MB",
  "Minimal satu baris klaim": "At least one claim line is required",
  // Rekrutmen, dokumen, checklist
  "Template checklist tidak ditemukan": "Checklist template not found",
  "Checklist tidak ditemukan": "Checklist not found",
  "Tugas checklist tidak ditemukan": "Checklist task not found",
  "Hanya penanggung jawab tugas atau HR yang bisa mengubah tugas ini":
    "Only the task owner or HR can change this task",
  "Tidak bisa menonaktifkan akun sendiri": "You cannot deactivate your own account",
  "Isi tanggal keluar karyawan terlebih dahulu": "Fill in the employee's resignation date first",
  "Pilih karyawan atau pelamar": "Choose an employee or applicant",
  "Pelamar yang sudah diterima tidak bisa dihapus": "Hired applicants cannot be deleted",
  "Pelamar sudah diterima menjadi karyawan": "The applicant has already been hired",
  "Wawancara tidak ditemukan": "Interview not found",
  "Pelamar sudah ditolak": "The applicant has been refused",
  "Pelamar tidak ditemukan": "Applicant not found",
  "Lowongan sudah ditutup": "The job opening is closed",
  "Lowongan tidak ditemukan": "Job opening not found",
  "Tanggal kedaluwarsa sebelum tanggal terbit": "The expiry date is before the issue date",
  "Isi alasan penolakan": "Fill in the refusal reason",
  "Minimal satu tugas": "At least one task is required",
  // Kinerja & pelatihan
  "Template penilaian tidak ditemukan": "Appraisal template not found",
  "Siklus penilaian sudah ditutup": "The appraisal cycle is closed",
  "Masih ada {} penilaian yang belum selesai dikalibrasi": "{0} appraisals are not calibrated yet",
  "Siklus penilaian tidak ditemukan": "Appraisal cycle not found",
  "Penilaian diri hanya oleh karyawan yang bersangkutan": "Only the employee can submit the self-assessment",
  "Penilaian diri sudah dikirim": "The self-assessment has already been submitted",
  "Hanya atasan langsung atau HR yang bisa menilai": "Only the direct manager or HR can review",
  "Tidak bisa menilai diri sendiri sebagai atasan": "You cannot review yourself as the manager",
  "Penilaian tidak sedang menunggu atasan": "The appraisal is not awaiting the manager",
  "Penilaian belum siap dikalibrasi": "The appraisal is not ready for calibration",
  "Penilaian tidak ditemukan": "Appraisal not found",
  "Peserta pelatihan tidak ditemukan": "Training participant not found",
  "Pelatihan tidak ditemukan": "Training not found",
  'Indikator "{}" belum dinilai': 'Indicator "{0}" has not been scored',
  "Bobot harus lebih dari 0": "The weight must be greater than 0",
  "Minimal satu indikator": "At least one indicator is required",
  "Skor 1–5": "Score 1–5",
  "Golongan tidak ditemukan": "Grade not found",
  "Foto belum diunggah": "No photo has been uploaded",
  "Data keluarga tidak ditemukan": "Family member not found",
  "Riwayat pendidikan tidak ditemukan": "Education record not found",
  "Pengalaman kerja tidak ditemukan": "Work experience not found",
  "Surat peringatan tidak ditemukan": "Warning letter not found",
  "Hanya mutasi draft yang bisa diubah": "Only draft movements can be edited",
  "Hanya mutasi draft yang bisa dihapus": "Only draft movements can be deleted",
  "Hanya mutasi draft yang bisa dibatalkan": "Only draft movements can be cancelled",
  "Mutasi sudah diterapkan atau dibatalkan": "The movement has already been applied or cancelled",
  "Karyawan sudah keluar sebelum tanggal efektif": "The employee resigned before the effective date",
  "Tidak ada perubahan dibanding data karyawan saat ini": "Nothing differs from the employee's current data",
  "Karyawan belum punya kontrak berjalan untuk diubah upahnya":
    "The employee has no running contract to change the wage of",
  "Mutasi tidak ditemukan": "Movement not found",
  "Berkas bukan gambar yang valid": "The file is not a valid image",
  "Dokumen bukan milik karyawan ini": "The document does not belong to this employee",
  "Karyawan surat peringatan tidak bisa diganti": "The warning letter's employee cannot be changed",
  "Karyawan mutasi tidak bisa diganti": "The movement's employee cannot be changed",
  "Tanggal efektif harus setelah awal kontrak berjalan":
    "The effective date must be after the running contract's start",
  "Foto harus JPG, PNG, atau WebP": "The photo must be JPG, PNG, or WebP",
  "Foto maksimal 1 MB": "The photo may be at most 1 MB",
  "Tahun lulus sebelum tahun masuk": "The graduation year is before the start year",
  "Isi minimal satu perubahan (jabatan, departemen, cabang, atasan, golongan, atau upah)":
    "Fill in at least one change (job, department, branch, manager, grade, or wage)",
  "Masa berlaku berakhir sebelum tanggal SP": "The validity ends before the warning date",
  "Kolom ekspor tidak dikenal: {}": "Unknown export columns: {0}",
  "Dataset tidak ditemukan": "Dataset not found",
  "Dataset ini hanya bisa diekspor": "This dataset can only be exported",
  "Pilih periode payroll": "Choose a payroll period",
  "Kolom data pribadi hanya untuk pemegang hak kelola": "Personal data columns require the manage permission",
  "Profil ekspor tidak ditemukan": "Export profile not found",
  "Hanya pembuat profil yang bisa menghapusnya": "Only the profile's creator can delete it",
  'Nilai "{}" tidak dikenal (pilihan: {})': 'Unknown value "{0}" (choices: {1})',
  'Isi "ya" atau "tidak", bukan "{}"': 'Enter "ya" (yes) or "tidak" (no), not "{0}"',
  'Tanggal "{}" tidak valid (gunakan YYYY-MM-DD atau DD/MM/YYYY)':
    'Invalid date "{0}" (use YYYY-MM-DD or DD/MM/YYYY)',
  'Angka "{}" tidak valid': 'Invalid number "{0}"',
  'Jam "{}" tidak valid (HH:MM)': 'Invalid time "{0}" (HH:MM)',
  'Karyawan dengan No. Karyawan "{}" tidak ditemukan': 'No employee with employee no. "{0}"',
  "{} tidak ada di periode payroll ini": "{0} is not in this payroll period",
  "Kolom data pribadi hanya bisa diimpor pemegang hr.manage":
    "Personal data columns can only be imported with hr.manage",
  "Periode tidak valid": "Invalid period",

  // ---- Mesin persetujuan ----
  "Delegasi tidak ditemukan": "Delegation not found",
  "Kategori persetujuan tidak ditemukan": "Approval category not found",
  "Kategori sudah dipakai permintaan; nonaktifkan saja (Aktif = tidak)":
    "The category is already used by requests; deactivate it instead (Active = no)",
  "Hanya permintaan draft yang bisa diubah": "Only draft requests can be edited",
  "Hanya permintaan draft yang bisa dihapus": "Only draft requests can be deleted",
  "Permintaan sudah diajukan": "The request has already been submitted",
  "Karyawan sudah resign; permintaan tidak bisa diproses":
    "The employee has resigned; the request cannot be processed",
  "Karyawan sudah resign; pengajuan tidak bisa diputuskan":
    "The employee has resigned; the request cannot be decided",
  "Permintaan sudah diputuskan": "The request has already been decided",
  "Permintaan sudah diproses": "The request has already been processed",
  "Tidak bisa menyetujui permintaan sendiri": "You cannot approve your own request",
  "Menunggu persetujuan penyetuju lain pada tahap ini": "Waiting for another approver at this step",
  "Lampiran tidak ditemukan": "Attachment not found",
  "Permintaan persetujuan tidak ditemukan": "Approval request not found",
  "Tidak bisa mendelegasikan kepada diri sendiri": "You cannot delegate to yourself",
  "Kode kategori sudah dipakai": "The category code is already used",
  "Kategori persetujuan tidak aktif": "The approval category is inactive",
  "User tidak punya akses ke perusahaan ini": "The user has no access to this company",
  "Tanggal selesai tidak boleh sebelum tanggal mulai": "The end date cannot be before the start date",
  "Kode 2–20 huruf besar/angka": "Code must be 2–20 uppercase letters/digits",
  "Nama wajib diisi": "Name is required",
  "Prefix wajib diisi": "Prefix is required",
  "Subjek wajib diisi": "Subject is required",
  "Lengkapi field wajib": "Fill in the required fields",
  "{} wajib diisi": "{0} is required",

  // ---- Cuti lanjutan ----
  "Rencana akrual tidak aktif": "The accrual plan is inactive",
  "Rencana akrual tidak ditemukan": "Accrual plan not found",
  "Jenis cuti ini tidak memakai jatah/saldo": "This time off type does not use allocations/balances",
  "Karyawan tidak ditemukan atau tidak aktif di perusahaan ini":
    "Employee not found or not active in this company",
  "Tanggal tidak valid": "Invalid date",
  "Tahun tidak valid": "Invalid year",
  "Cuti massal tidak ditemukan atau sudah dibatalkan": "Mass time off not found or already cancelled",
  "Hanya lembur yang sudah disetujui": "Only approved overtime",
  "Cuti pengganti hanya untuk lembur di hari istirahat/libur":
    "Compensatory leave is only for overtime on rest days/holidays",
  "Lembur ini sudah dijadikan cuti pengganti":
    "This overtime has already been converted to compensatory leave",
  "Lembur sudah dibayar di slip gaji": "The overtime has already been paid in a payslip",
  "Lembur kurang dari 4 jam tidak menjadi cuti pengganti":
    "Overtime under 4 hours does not become compensatory leave",
  "{} hanya bisa diajukan oleh HR": "{0} can only be requested by HR",
  "{} wajib melampirkan bukti": "{0} requires a supporting document",
  "Delegasi tugas tidak bisa ke diri sendiri": "Tasks cannot be delegated to yourself",
  "Karyawan delegasi harus di perusahaan yang sama": "The delegate must be in the same company",
  "{} tidak bisa diambil setengah hari": "{0} cannot be taken as a half day",
  "{} maksimal {} hari per pengajuan (diminta {})": "{0} allows at most {1} days per request ({2} requested)",
  "Cuti tidak bisa diambil {} s.d. {}: {}": "Time off cannot be taken from {0} to {1}: {2}",
  "Saldo {} melebihi batas minus {} hari (sisa {}, diminta {})":
    "{0} balance would exceed the negative limit of {1} days ({2} left, {3} requested)",
  "Setengah hari hanya untuk cuti satu hari": "Half days are only for single-day time off",
  "Isi batas hari yang dibawa": "Enter the carry-over day limit",

  // ---- Absensi lanjutan ----
  "Koreksi absensi tidak ditemukan": "Attendance correction not found",
  "Permintaan tukar shift tidak ditemukan": "Shift change request not found",
  "Absensi s.d. {} sudah dikunci; tanggal {} tidak bisa diubah":
    "Attendance up to {0} is locked; {1} cannot be changed",
  "Karyawan tidak aktif": "The employee is inactive",
  "Di luar area {}: {} m dari lokasi (radius {} m)": "Outside {0}: {1} m from the location (radius {2} m)",
  "Aktifkan lokasi (GPS) untuk absen di {}": "Turn on location (GPS) to check in at {0}",
  "Absensi tidak ditemukan": "Attendance not found",
  "Foto tidak ditemukan": "Photo not found",
  "Kode badge atau PIN salah": "Wrong badge code or PIN",
  "Mesin absensi tidak ditemukan": "Attendance device not found",
  "Kunci mesin absensi tidak valid": "Invalid attendance device key",
  "Jadwal karyawan sudah berubah sejak diajukan; pengajuan tidak bisa disetujui":
    "The employee's schedule changed since the request; it cannot be approved",
  "Jadwal yang diminta sama dengan jadwal saat ini": "The requested schedule is the current schedule",
  "Lokasi kerja tidak ditemukan di perusahaan ini": "Work location not found in this company",
  "Foto harus JPG atau PNG": "The photo must be JPG or PNG",
  "Berkas harus PDF, JPG, PNG, CSV, atau XLSX": "The file must be PDF, JPG, PNG, CSV, or XLSX",
  "Foto tidak valid": "Invalid photo",
  "Radius minimal 10 m": "The radius must be at least 10 m",
  "Alasan maksimal 200 karakter": "The reason is at most 200 characters",
  "Pilih minimal satu absensi": "Select at least one attendance",
  "PIN 4–8 digit angka": "PIN must be 4–8 digits",
  "Kode badge wajib diisi": "Badge code is required",
  "Berkas maksimal 5 MB": "Files are at most 5 MB",
  "Format bulan YYYY-MM": "Month format YYYY-MM",
  "Alasan wajib diisi": "Reason is required",
  // ---- Payroll lanjutan ----
  "THR & rapel dihitung di payroll reguler, bukan payroll koreksi":
    "THR & back pay are computed in the regular payroll, not a correction payroll",
  "Koreksi dibuat dari payroll reguler": "Corrections are created from a regular payroll",
  "Payroll belum diposting; ubah slipnya langsung":
    "The payroll is not posted yet; edit its payslips directly",
  "Karyawan tidak ada di payroll ini": "The employee is not in this payroll",
  "Gaji payroll yang sudah dibayar tidak bisa ditahan": "Salary of a paid payroll cannot be held",
  "Gaji yang ditahan sudah dilepas": "The held salary was already released",
  "Gaji tidak sedang ditahan": "The salary is not on hold",
  "Payroll sudah dibayar; lepas gaji yang ditahan dengan pembayaran terpisah":
    "The payroll is already paid; release the held salary with a separate payment",
  "Posting payroll sebelum melepas gaji yang ditahan": "Post the payroll before releasing a held salary",
  "Slip gaji masih kosong; isi selisih koreksinya": "The payslip is empty; enter the correction amounts",
  "Pilih minimal satu karyawan": "Select at least one employee",
  // ---- Rekrutmen hulu & offboarding ----
  "Alasan penolakan tidak ditemukan": "Refusal reason not found",
  "Template penawaran tidak ditemukan": "Offer template not found",
  "Pelamar sudah diterima/ditolak": "The applicant was already hired/refused",
  "Pelamar masih punya penawaran aktif; batalkan dulu":
    "The applicant still has an active offer; cancel it first",
  "Penawaran tidak ditemukan": "Job offer not found",
  "Penawaran sudah kedaluwarsa": "The job offer has expired",
  "Status penawaran tidak sesuai": "Invalid job offer status for this action",
  "Permintaan tidak ditemukan": "Request not found",
  "Hanya Formulir Permintaan Karyawan (FPK)": "Only manpower requisitions (FPK)",
  "FPK belum disetujui": "The manpower requisition is not approved yet",
  "Lowongan untuk FPK ini sudah dibuat": "A job opening was already created for this requisition",
  "Masa berlaku sudah lewat": "The validity date has passed",
  "Pilih template atau isi surat penawaran": "Choose a template or write the offer letter",
  "Isi tanggal mulai bekerja": "Enter the start date",
  "Isi gaji": "Enter the wage",
  "Pilih alasan penolakan": "Choose a refusal reason",
  "Tanggal berakhir kontrak sebelum tanggal mulai": "The contract end date is before the start date",
  // ---- Kinerja lanjutan & layanan mandiri ----
  "Sasaran perusahaan/departemen hanya diatur HR (hr.manage)":
    "Company/department goals are managed by HR (hr.manage)",
  "Hanya karyawan, atasan langsung, atau HR": "Only the employee, their direct manager or HR",
  "Sasaran tidak aktif": "The goal is not active",
  "Sasaran tidak ditemukan": "Goal not found",
  "Hanya atasan langsung atau HR": "Only the direct manager or HR",
  "Permintaan feedback tidak ditemukan": "Feedback request not found",
  "Permintaan feedback sudah dijawab": "The feedback request was already answered",
  "Catatan ini tidak tersedia untuk karyawan yang bersangkutan":
    "These notes are not available to the employee concerned",
  "Catatan tidak ditemukan": "Note not found",
  "Pengumuman tidak ditemukan": "Announcement not found",
  "Rentang tanggal maksimal 3 bulan": "The date range is at most 3 months",
  "Induk tidak boleh sasaran ini atau turunannya": "The parent cannot be this goal or one of its descendants",
  "Sasaran induk tidak ditemukan": "Parent goal not found",
  "Penilai harus pengguna di perusahaan ini": "Reviewers must be users of this company",
  "Karyawan menilai diri sendiri lewat relasi 'diri sendiri'":
    "Employees review themselves with the 'self' relation",
  "Kompetensi tidak dikenal: {}": "Unknown competency: {0}",
  "Isi minimal satu skor kompetensi": "Enter at least one competency score",
  "Pilih karyawan atau departemen, bukan keduanya": "Choose an employee or a department, not both",
  "Target harus berbeda dari nilai awal": "The target must differ from the start value",
  "Pilih minimal satu penilai": "Choose at least one reviewer",
  "Sasaran dari atasan hanya bisa dihapus atasan atau HR":
    "Goals set by a manager can only be deleted by the manager or HR",
  // ---- Armada ----
  "Kendaraan tidak ditemukan": "Vehicle not found",
  "Servis tidak ditemukan": "Service not found",
  "Tagihan untuk servis ini sudah dibuat": "A vendor bill was already created for this service",
  "Servis dibatalkan tidak dapat ditagihkan": "A cancelled service cannot be billed",
  "Servis yang sudah ditagihkan tidak dapat diubah biaya/vendor/kendaraannya":
    "The cost, vendor or vehicle of a billed service cannot be changed",
  "Servis yang sudah ditagihkan tidak dapat dihapus": "A billed service cannot be deleted",
  "Kontrak sudah ditutup": "The contract is already closed",
  "Kontrak tanpa tanggal berakhir tidak perlu diperpanjang":
    "A contract without an end date does not need renewal",
  "Butuh hak akuntansi untuk membuat tagihan vendor": "Accounting rights are required to create vendor bills",
  "Hanya pengemudi kendaraan ini yang dapat mencatat odometer":
    "Only this vehicle's driver can log the odometer",
  "Kendaraan tidak ditemukan di perusahaan ini": "Vehicle not found in this company",
  "Jenis layanan tidak ditemukan di perusahaan ini": "Service type not found in this company",
  "Odometer tidak boleh lebih kecil dari pembacaan sebelumnya ({})":
    "The odometer cannot be lower than the previous reading ({0})",
  "Odometer melebihi pembacaan setelah tanggal ini ({})": "The odometer exceeds a later reading ({0})",
  "Isi vendor sebelum membuat tagihan": "Set the vendor before creating a bill",
  "Biaya servis harus lebih dari 0": "The service cost must be greater than 0",
  "Produsen sudah ada": "Manufacturer already exists",
  "Nomor polisi sudah terdaftar": "License plate is already registered",
  "Tanggal berakhir sebelum tanggal mulai": "End date is before start date",
  "Format nomor polisi tidak valid (mis. B 1234 XYZ)": "Invalid license plate format (e.g. B 1234 XYZ)",
  "Tidak boleh negatif": "Must not be negative",
  // ---- RBAC ----
  "Anda tidak dapat memberi atau mencabut hak yang tidak Anda miliki: {}":
    "You cannot grant or revoke permissions you do not hold: {0}",
  "Hak akses dan status akun sendiri tidak dapat diubah sendiri":
    "You cannot change your own access or account status",
  "Akun ini memiliki hak di atas hak Anda; hanya admin penuh yang dapat mengubahnya":
    "This account has permissions beyond yours; only a full administrator can change it",
  "Harus ada minimal satu administrator aktif": "There must be at least one active administrator",
  "Hak peran Administrator bawaan tidak dapat diubah":
    "The built-in Administrator role's permissions cannot be changed",
  "Kode peran bawaan tidak dapat diubah": "The code of a built-in role cannot be changed",
  "Peran bawaan tidak dapat dihapus": "Built-in roles cannot be deleted",
  "Peran masih dipakai pengguna; lepaskan dari pengguna terlebih dahulu":
    "The role is still assigned to users; remove it from them first",
  "Peran tidak ditemukan": "Role not found",
  "Tidak dapat memberi akses ke perusahaan yang tidak bisa Anda akses":
    "You cannot grant access to a company you cannot access",
  "Perusahaan default harus termasuk yang dipilih":
    "The default company must be one of the selected companies",
  "Peran per perusahaan hanya untuk perusahaan yang boleh diakses pengguna ini":
    "Company-specific roles must target a company this user can access",
  "Hak khusus per perusahaan hanya untuk perusahaan yang boleh diakses pengguna ini":
    "Company-specific permissions must target a company this user can access",
  "Kode 2–40 huruf kecil, angka, - atau _": "Code must be 2–40 lowercase letters, digits, - or _",
  "Kode peran sudah dipakai": "Role code is already in use",
  "Kode hak akses tidak dikenal": "Unknown permission code",
  "Hak admin penuh hanya lewat peran": "Full admin access can only be given through a role",
  // ---- Aturan persetujuan ----
  "Nominal melebihi batas wewenang Anda ({})": "The amount exceeds your approval limit ({0})",
  "Tidak bisa menyetujui PO sendiri": "You cannot approve your own purchase order",
  "Jenis dokumen tidak dikenal": "Unknown document type",
  "Pilih pengguna": "Select a user",
  "Pilih peran": "Select a role",
  "Pilih peran atau pengguna, bukan keduanya": "Select a role or a user, not both",
  "Pilih satu: user atau peran": "Select one: a user or a role",
  "Kategori hanya untuk permintaan persetujuan": "Categories only apply to approval requests",
  "Batas untuk pihak ini sudah ada": "A limit for this party already exists",
  "Harus angka ≥ 0": "Must be a number ≥ 0",
  // ---- Platform SaaS ----
  "Tanggal akhir gratis harus di masa depan": "The free-until date must be in the future",
  "Paket uji coba tidak bisa dihapus; nonaktifkan saja":
    "The trial plan cannot be deleted; deactivate it instead",
  "Paket sudah dipakai tenant atau tagihan; nonaktifkan saja":
    "The plan is used by tenants or invoices; deactivate it instead",
  "Kode paket sudah dipakai": "Plan code is already in use",
  // ---- Form karyawan ----
  "Karyawan sudah punya akun login": "The employee already has a login account",
  "Isi email kerja atau email pribadi karyawan terlebih dahulu":
    "Fill in the employee's work or personal email first",
  "Email wajib diisi untuk undangan": "An email is required for the invitation",
  "Maksimal 10 tag": "At most 10 tags",
  // ---- Aplikasi terhubung ----
  "Aplikasi tidak ditemukan atau nonaktif": "App not found or inactive",
  "Aplikasi tidak ditemukan": "App not found",
  "redirect_uri tidak terdaftar untuk aplikasi ini": "redirect_uri is not registered for this app",
  "post_logout_redirect_uri tidak terdaftar untuk aplikasi ini":
    "post_logout_redirect_uri is not registered for this app",
  "Aplikasi ini terdaftar di tenant lain; masuk dengan akun tenant tersebut":
    "This app belongs to another tenant; sign in with an account of that tenant",
  "scope harus memuat openid": "scope must include openid",
  "Akun ini tidak dapat masuk ke aplikasi": "This account cannot sign in to apps",
  "Token aplikasi hanya untuk profil; gunakan akun layanan untuk API":
    "App sign-in tokens are for the profile only; use the service account for the API",
  "Butuh access token": "An access token is required",
  "Webhook belum diatur": "Webhook is not configured",
  "Pengiriman webhook tidak ditemukan": "Webhook delivery not found",
  "updatedSince harus tanggal ISO 8601": "updatedSince must be an ISO 8601 date",
  "cursor tidak valid": "Invalid cursor",
  "response_type harus code": "response_type must be code",
  "code_challenge_method harus S256": "code_challenge_method must be S256",
  "code_challenge (PKCE) wajib": "code_challenge (PKCE) is required",
  "URL harus https:// (http:// hanya untuk localhost) dan tanpa #":
    "URL must be https:// (http:// only for localhost) without #",
  // ---- Kompensasi & benefit ----
  "Paket benefit sudah dipakai di slip gaji; nonaktifkan saja paket ini":
    "The benefit plan is already used in payslips; deactivate it instead",
  "Paket & karyawan kepesertaan tidak bisa diganti; buat kepesertaan baru":
    "The plan and employee of an enrollment cannot be changed; create a new enrollment",
  "Paket benefit tidak ditemukan": "Benefit plan not found",
  "Kepesertaan benefit tidak ditemukan": "Benefit enrollment not found",
  "Pilih akun utang premi/iuran ke penyedia": "Choose the premium/contribution payable account",
  "Tanggungan harus anggota keluarga karyawan ini": "Dependents must be family members of this employee",
  "Karyawan sudah terdaftar di paket ini pada periode tersebut":
    "The employee is already enrolled in this plan for that period",
  "Kode paket benefit sudah dipakai": "The benefit plan code is already in use",
  "Akun utang benefit {} belum diatur": "The payable account for benefit {0} is not set",
  "Persentase maksimal 100": "At most 100 percent",
  "Golongan tidak boleh dobel": "Each grade may appear only once",
  // ---- Siklus kenaikan gaji ----
  "Hanya siklus draft yang bisa diubah": "Only draft cycles can be changed",
  "Siklus yang sudah diajukan tidak bisa dihapus; batalkan saja":
    "A submitted cycle cannot be deleted; cancel it instead",
  "Usulan kenaikan tidak ditemukan": "Raise proposal not found",
  "Hanya HR atau atasan langsung yang bisa mengubah usulan":
    "Only HR or the direct manager can change the proposal",
  "Siklus sudah diajukan; usulan terkunci": "The cycle has been submitted; proposals are locked",
  "Siklus sudah diajukan": "The cycle has already been submitted",
  "Belum ada usulan kenaikan": "There are no raise proposals yet",
  "Usulan melebihi anggaran Rp {} (terpakai Rp {}); sesuaikan usulan atau anggaran":
    "Proposals exceed the budget of Rp {0} (used Rp {1}); adjust the proposals or the budget",
  "Siklus sudah diterapkan atau dibatalkan": "The cycle has already been applied or cancelled",
  "Siklus belum disetujui": "The cycle has not been approved yet",
  "Kontrak {} sudah berubah sejak usulan dibuat; perbarui usulan lewat siklus baru":
    "The contract of {0} changed after the proposal was made; propose again in a new cycle",
  "Siklus kenaikan gaji tidak ditemukan": "Salary review cycle not found",
  "Departemen tidak ditemukan": "Department not found",
  "Isi persentase kenaikan atau upah baru": "Enter a raise percentage or a new wage",
  // ---- Laporan kustom & terjadwal ----
  "Belum ada payroll terposting": "There is no posted payroll yet",
  "Laporan tidak ditemukan": "Report not found",
  "Jadwal laporan tidak ditemukan": "Report schedule not found",
  "Pilih hari pengiriman": "Choose the delivery day",
  "Pilih tanggal pengiriman": "Choose the delivery date",
  "Email penerima tidak valid": "Invalid recipient email",
  "Isi minimal satu penerima": "Enter at least one recipient",
  "Kolom laporan tidak dikenal: {}": "Unknown report column: {0}",
  // ---- Anggaran tenaga kerja & analitik SDM ----
  "Impor anggaran gagal": "Budget import failed",
  "Baris anggaran dobel (departemen, jabatan, bulan sama)":
    "Duplicate budget line (same department, job position and month)",
  "Bulan harus 1–12": "Month must be 1–12",
  'Departemen "{}" tidak ditemukan': 'Department "{0}" not found',
  'Jabatan "{}" tidak ditemukan': 'Job position "{0}" not found',
  // ---- Man Power Planning ----
  "MPP tidak ditemukan": "Manpower plan not found",
  "MPP departemen ini untuk tahun tersebut sudah ada":
    "A manpower plan for this department and year already exists",
  "Hanya MPP draft yang bisa diubah": "Only draft manpower plans can be edited",
  "Hanya MPP draft yang bisa dihapus": "Only draft manpower plans can be deleted",
  "MPP sudah diajukan": "Manpower plan already submitted",
  "Belum ada posisi dalam MPP": "The manpower plan has no positions",
  "MPP sudah dibatalkan": "Manpower plan already cancelled",
  "Butuh permission hr.manage untuk membatalkan MPP yang disetujui":
    "hr.manage permission is required to cancel an approved manpower plan",
  "Hanya MPP yang disetujui yang bisa direvisi": "Only approved manpower plans can be revised",
  "Baris MPP tidak ditemukan": "Manpower plan line not found",
  "MPP belum disetujui": "Manpower plan not approved yet",
  "Posisi terisi tidak perlu lowongan": "Existing positions do not need a job opening",
  "Lowongan untuk posisi ini sudah dibuat": "A job opening for this position already exists",
  "Karyawan yang diganti tidak ditemukan": "Replaced employee not found",
  "Hanya HR (hr.manage) atau kepala departemen yang bisa mengubah MPP ini":
    "Only HR (hr.manage) or the department head can change this manpower plan",
  "Pengaturan payroll belum diisi; anggaran akuntansi belum dibuat":
    "Payroll settings are missing; the accounting budget was not created",
  "Anggaran ini dikelola dari Man Power Planning (SDM); ubah lewat MPP":
    "This budget is managed by Manpower Planning (HR); change it through the plan",
  "Bulan akhir sebelum bulan mulai": "End month is before start month",
  "Jumlah posisi minimal 1": "At least 1 position",
  "Bulan 1–12": "Month 1–12",
  // ---- Proyek dari aplikasi terhubung ----
  "Perusahaan tidak dapat diakses akun layanan aplikasi":
    "The app's service account cannot access this company",
  "Proyek belum dikirim ke ERP": "The project has not been sent to the ERP yet",
  "Task belum dikirim ke ERP": "The task has not been sent to the ERP yet",
  "Hanya untuk akun layanan aplikasi terhubung": "Only for connected-app service accounts",
  "externalId tidak valid": "Invalid externalId",
  "Proyek tidak ditemukan": "Project not found",
  "Isi employeeId, employeeEmail, atau employeeNumber": "Provide employeeId, employeeEmail or employeeNumber",
  "Tanggal harus format YYYY-MM-DD": "Dates must use the YYYY-MM-DD format",
  "Jam maksimal 24 per baris": "At most 24 hours per line",
  "Jam harus lebih dari 0": "Hours must be greater than 0",
  "Maksimal 1000 baris per batch": "At most 1000 lines per batch",
  // Dokumen & tanda tangan kontrak
  "Template sudah dipakai kontrak; nonaktifkan saja agar tidak dipilih lagi":
    "The template is used by contracts; deactivate it instead so it is no longer offered",
  "Karyawan belum punya akun portal; undang dulu atau tanda tangani langsung di hadapan HR":
    "The employee has no portal account yet; invite them first or have them sign in person with HR",
  "Karyawan menandatangani sendiri lewat portal; tanda tangan oleh HR hanya bila karyawan hadir langsung":
    "Employees sign through the portal themselves; HR may capture their signature only when they are present in person",
  "Isi nama penandatangan perusahaan dulu": "Enter the company signatory's name first",
  "Kontrak ini tidak sedang menunggu tanda tangan Anda": "This contract is not waiting for your signature",
  "Kode verifikasi tidak dikenal": "Unknown verification code",
  "Tanda tangan harus berupa gambar PNG": "The signature must be a PNG image",
  "Template kontrak tidak ditemukan": "Contract template not found",
  "Isi dokumen kontrak kosong; pilih template dulu":
    "The contract document is empty; choose a template first",
  "Belum ada berkas kontrak bertanda tangan": "No signed contract file has been uploaded yet",
  "Kontrak sudah ditandatangani; batalkan tanda tangan dulu untuk mengubah isi atau syarat kontrak":
    "The contract is already signed; revoke the signatures first to change its text or terms",
  "Kontrak belum ditandatangani secara digital di aplikasi":
    "The contract has not been signed digitally in the app",
  "Kontrak sudah ditandatangani": "The contract is already signed",
  "Kontrak sudah ditandatangani lewat dokumen yang diunggah":
    "The contract was already signed through an uploaded document",
  "Kontrak sedang ditandatangani digital di aplikasi; batalkan tanda tangan dulu":
    "The contract is being signed digitally in the app; revoke those signatures first",
  "Isi berkas tidak sesuai jenisnya (PDF/JPG/PNG)": "The file content does not match its type (PDF/JPG/PNG)",
  "Centang persetujuan isi kontrak": "Tick the box to agree to the contract text",
  "Tanda tangan kosong": "The signature is empty",
  "Gambar tanda tangan terlalu besar": "The signature image is too large",
  "Pilih berkas": "Choose a file",
  "Upah harus berupa angka": "The wage must be a number",
  "Upah harus lebih dari 0": "The wage must be greater than 0",
  "Berkas maksimal 7 MB": "Files can be at most 7 MB",
  "Pihak perusahaan sudah menandatangani": "The company has already signed",
  "Karyawan sudah menandatangani": "The employee has already signed",
  "Butuh permission hr.manage untuk membuat kontrak kerja":
    "The hr.manage permission is required to create an employment contract",
  // Tanggal masuk/keluar dari kontrak kerja
  "Kontrak sudah berakhir": "The contract has already ended",
  "Ada kontrak draft {} setelah kontrak ini; hapus draftnya dulu":
    "There is a draft contract {0} after this one; delete the draft first",
  "Kontrak {} masih berjalan setelah kontrak ini; akhiri dari kontrak terakhir":
    "Contract {0} is still running after this one; end the latest contract instead",
  "Kontrak ini tidak diakhiri karena karyawan keluar":
    "This contract was not ended because the employee left",
  "Tanggal masuk diubah lewat tanggal mulai kontrak kerja pertama":
    "The join date is changed through the start date of the first employment contract",
  "Tanggal keluar diisi lewat Akhiri kontrak (karyawan keluar) di kontrak kerja":
    "The leaving date is set with End contract (employee leaves) on the employment contract",
  "Karyawan sudah keluar per {}; batalkan keluar di kontrak terakhirnya dulu":
    "The employee left on {0}; cancel the leaving on their last contract first",
  "Tanggal mulai kontrak pertama (tanggal masuk) setelah tanggal keluar karyawan":
    "The first contract's start date (join date) is after the employee's leaving date",
  "Pilih alasan keluar": "Choose a leaving reason",
  "Nilai harus berupa angka": "The value must be a number",
  "Jenis kontrak bawaan (PKWT/PKWTT) tidak bisa dihapus":
    "Built-in contract types (PKWT/PKWTT) cannot be deleted",
  "Jenis kontrak bawaan (PKWT/PKWTT) tidak bisa dinonaktifkan":
    "Built-in contract types (PKWT/PKWTT) cannot be deactivated",
  "Jenis kontrak {} sudah dipakai {} dokumen; nonaktifkan saja agar tidak dipilih lagi":
    "Contract type {0} is used by {1} documents; deactivate it instead so it can no longer be chosen",
  "Jenis kontrak tidak ditemukan": "Contract type not found",
  'Jenis kontrak "{}" tidak dikenal': 'Unknown contract type "{0}"',
  "Jenis kontrak {} sudah nonaktif": "Contract type {0} is inactive",
  "Kode {} sudah dipakai": "Code {0} is already used",
  "Kode jenis kontrak tidak bisa diubah": "A contract type's code cannot be changed",
  "Kode jenis kontrak 2–20 karakter: huruf kecil, angka, - atau _":
    "Contract type code: 2–20 characters of lowercase letters, digits, - or _",
  "Isi nama": "Enter a name",
  "Minimal 1 bulan": "At least 1 month",
  "{} wajib punya tanggal berakhir": "{0} needs an end date",
  "Masa {} paling lama {} bulan": "{0} may last at most {1} months",
  "{} tidak berhak upah lembur": "{0} is not entitled to overtime pay",
  "Jenis kontrak {} tidak mendapat pesangon atau uang kompensasi":
    "Contract type {0} is not entitled to severance or compensation",
  "Jenis kontrak {} mendapat uang kompensasi PKWT, bukan pesangon":
    "Contract type {0} receives fixed-term compensation, not severance",
  "Jenis kontrak {} mendapat pesangon, bukan uang kompensasi PKWT":
    "Contract type {0} receives severance, not fixed-term compensation",
  "Kontrak mulai melewati tanggal pensiun {} (usia {} tahun); atur usia pensiun khusus karyawan bila masa kerja diperpanjang":
    "The contract starts after the retirement date {0} (age {1}); set an employee-specific retirement age to extend employment",
  "Kontrak berakhir melewati tanggal pensiun {} (usia {} tahun); atur usia pensiun khusus karyawan bila masa kerja diperpanjang":
    "The contract ends after the retirement date {0} (age {1}); set an employee-specific retirement age to extend employment",
  "Pengecualian ganda": "Duplicate exception",
  "Jabatan/golongan/departemen tidak ditemukan": "Job position/grade/department not found",
  "Usia pensiun 40–80 tahun": "Retirement age must be 40–80",
  // ---- Batas kredit & dunning ----
  "Urutan tingkat sudah dipakai": "The level sequence is already used",
  "Tingkat dunning tidak ditemukan": "Dunning level not found",
  "Surat teguran tidak ditemukan": "Dunning letter not found",
  "Nominal tidak valid": "Invalid amount",
  // ---- Penangguhan & jurnal berulang ----
  // ---- Landed cost ----
  "Lapisan valuasi penerimaan tidak ditemukan": "Receipt valuation layer not found",
  "Landed cost tidak ditemukan": "Landed cost not found",
  "Penerimaan tidak ditemukan atau belum selesai": "Receipt not found or not done yet",
  "Tagihan pemasok tidak ditemukan": "Vendor bill not found",
  "Hanya landed cost draft yang bisa diubah": "Only draft landed costs can be changed",
  "Landed cost terposting tidak bisa dihapus; batalkan dulu":
    "A posted landed cost cannot be deleted; cancel it first",
  "Penerimaan terpilih tidak memuat barang stok yang tervaluasi":
    "The selected receipts contain no valued stock products",
  "Landed cost sudah diposting atau dibatalkan": "The landed cost is already posted or cancelled",
  "Landed cost sudah dibatalkan": "The landed cost is already cancelled",
  "Barang yang menanggung landed cost ini sudah keluar sejak diposting; buat koreksi dengan landed cost baru":
    "Goods carrying this landed cost have left stock since posting; correct it with a new landed cost",
  "Tagihan pemasok terposting tidak ditemukan": "Posted vendor bill not found",
  "Pilih minimal satu penerimaan": "Select at least one receipt",
  "Minimal satu baris biaya": "At least one cost line",
  'Dasar pembagian "{}" nol untuk barang ini': 'The "{0}" split basis is zero for these products',
  "Angka tidak valid (maks. 6 desimal)": "Invalid number (max. 6 decimals)",
  // ---- Payment run ----
  "Kontak tidak ditemukan": "Contact not found",
  "Rekening tidak ditemukan": "Bank account not found",
  "Nomor rekening sudah terdaftar untuk kontak ini":
    "This account number is already registered for the contact",
  "Rekening sudah dipakai payment run; nonaktifkan saja":
    "The bank account is used by a payment run; deactivate it instead",
  "Payment run tidak ditemukan": "Payment run not found",
  "Tidak ada tagihan pemasok terbuka yang jatuh tempo sampai tanggal itu":
    "No open vendor bills are due by that date",
  "Hanya payment run draft yang bisa diubah": "Only draft payment runs can be changed",
  "Baris tidak ditemukan di payment run ini": "Line not found in this payment run",
  "Rekening bukan milik pemasok ini atau tidak aktif":
    "The bank account does not belong to this vendor or is inactive",
  "Payment run sudah diajukan": "The payment run has already been submitted",
  "Tidak ada tagihan yang diikutkan": "No bills are included",
  "Payment run yang sudah dieksekusi atau dibatalkan tidak bisa dibatalkan":
    "An executed or cancelled payment run cannot be cancelled",
  "Payment run harus disetujui sebelum dieksekusi": "The payment run must be approved before it is executed",
  "Sisa tagihan berubah sejak disetujui (sudah dibayar/dibatalkan)":
    "The bill's open amount changed since approval (already paid/cancelled)",
  "Payment run belum dieksekusi": "The payment run has not been executed yet",
  "Tidak ada pembayaran terposting untuk pemasok ini di run ini":
    "No posted payments for this vendor in this run",
  "File bank tersedia setelah payment run disetujui":
    "The bank file is available once the payment run is approved",
  "Nomor rekening perusahaan belum diisi di jurnal bank ini":
    "The company account number is not set on this bank journal",
  "Nomor rekening 5–34 digit angka": "The account number must be 5–34 digits",
  "Jumlah melebihi sisa tagihan ({})": "The amount exceeds the bill's open amount ({0})",
  "Transfer gagal": "Transfer failed",
  // ---- Controlling ----
  "Kunci statistik dipakai siklus alokasi; nonaktifkan saja":
    "The statistical key is used by an allocation cycle; deactivate it instead",
  "Kunci statistik tidak ditemukan": "Statistical key not found",
  "Kunci jumlah karyawan dihitung otomatis dan tidak bisa diisi":
    "The headcount key is computed automatically and cannot be entered",
  "Siklus alokasi tidak ditemukan": "Allocation cycle not found",
  "Cost center tidak ditemukan di perusahaan ini": "Cost center not found in this company",
  "Kode sudah dipakai": "Code already in use",
  "Siklus sudah pernah dijalankan; nonaktifkan saja": "The cycle has already been run; deactivate it instead",
  "Nilai kunci statistik semua penerima nol untuk bulan ini":
    "The statistical key value of every receiver is zero for this month",
  "Total persen penerima nol": "The receivers' total percentage is zero",
  "Tidak ada biaya di cost center sumber pada bulan ini": "No costs in the source cost center this month",
  "Hasil alokasi tidak ditemukan": "Allocation result not found",
  "Hasil alokasi ini sudah dibalik": "This allocation result has already been reversed",
  "Balik dulu alokasi lanjutan yang memakai hasil ini: {}":
    "First reverse the follow-up allocations that use this result: {0}",
  "Angka tidak valid (maks. 4 desimal)": "Invalid number (max. 4 decimals)",
  "Pilih kunci statistik": "Select a statistical key",
  "Penerima tidak boleh sama dengan sumber": "A receiver cannot be the same as the source",
  "Penerima ganda": "Duplicate receiver",
  "Isi persen lebih dari 0": "Enter a percentage above 0",
  "Total persen harus 100 (sekarang {})": "The total percentage must be 100 (currently {0})",
  "Minimal satu penerima": "At least one receiver",
  "Total bobot alokasi harus lebih dari 0": "The total allocation weight must be above 0",
  "Cost center tidak ditemukan atau tidak aktif di perusahaan ini":
    "Cost center not found or inactive in this company",
  "Profit center tidak ditemukan atau tidak aktif di perusahaan ini":
    "Profit center not found or inactive in this company",
  "Cost center wajib diisi untuk baris akun beban: {}. Isi cost center di baris, atau atur cost center bawaan di akun":
    "A cost center is required on expense account lines: {0}. Fill in the cost center on the line, or set a default cost center on the account",
  "Induk tidak ditemukan di perusahaan ini": "Parent not found in this company",
  "Induk tidak boleh dirinya sendiri atau turunannya":
    "The parent cannot be itself or one of its descendants",
  "Profit center tidak ditemukan di perusahaan ini": "Profit center not found in this company",
  "Masih punya turunan; pindahkan atau hapus turunannya dulu":
    "It still has children; move or delete them first",
  "Sudah dipakai di jurnal; nonaktifkan saja": "Already used in journal entries; deactivate it instead",
  "Cost center tidak ditemukan": "Cost center not found",
  "Kode wajib diisi": "Code is required",
  "Kode hanya huruf, angka, titik, garis bawah, atau strip":
    "Code may only contain letters, digits, dots, underscores, or hyphens",
  "Akun pendapatan diterima di muka belum diatur di Pengaturan Akuntansi":
    "The deferred revenue account is not set in Accounting Settings",
  "Akun biaya dibayar di muka belum diatur di Pengaturan Akuntansi":
    "The prepaid expense account is not set in Accounting Settings",
  "Tanggal pembalikan harus setelah tanggal entri": "The reversal date must be after the entry date",
  "Jurnal berulang tidak ditemukan": "Recurring entry not found",
  "Jurnal berulang sudah menghasilkan entri; nonaktifkan saja":
    "The recurring entry has already generated entries; deactivate it instead",
  "Jurnal berulang tidak aktif": "The recurring entry is inactive",
  "Isi tanggal mulai dan akhir penangguhan": "Fill in both the deferral start and end dates",
  "Tanggal akhir penangguhan sebelum tanggal mulai": "The deferral end date is before the start date",
  "Total debit dan kredit harus sama": "Total debit and credit must be equal",
  "Total jurnal tidak boleh nol": "The entry total cannot be zero",
  "Isi debit atau kredit, bukan keduanya": "Fill in debit or credit, not both",
  "Angka tidak valid (maks. 2 desimal, tidak negatif)": "Invalid number (max. 2 decimals, not negative)",
  // ---- Kontrak pembelian ----
  "Baris kontrak tidak ada di kontrak PO ini": "The contract line is not in this PO's contract",
  "Baris kontrak tidak ditemukan": "Contract line not found",
  "Hanya kontrak aktif yang bisa ditutup": "Only active contracts can be closed",
  "Hanya kontrak batal atau ditolak yang bisa dikembalikan ke draft":
    "Only cancelled or refused contracts can be reset to draft",
  "Hanya kontrak draft atau yang menunggu persetujuan yang bisa dibatalkan":
    "Only draft contracts or contracts awaiting approval can be cancelled",
  "Hanya kontrak draft yang bisa diubah": "Only draft contracts can be edited",
  "Hanya kontrak draft, batal, atau ditolak yang bisa dihapus":
    "Only draft, cancelled or refused contracts can be deleted",
  "Kontrak belum aktif atau sudah ditutup": "The contract is not active or already closed",
  "Kontrak pembelian belum aktif atau sudah ditutup": "The purchase contract is not active or already closed",
  "Kontrak pembelian milik pemasok lain": "The purchase contract belongs to another vendor",
  "Kontrak pembelian tidak ditemukan": "Purchase contract not found",
  "Kontrak sudah diajukan": "The contract has already been submitted",
  "Kontrak sudah dipakai PO; batalkan saja": "The contract is already used by a PO; cancel it instead",
  "Mata uang PO harus sama dengan mata uang kontrak": "The PO currency must match the contract currency",
  "Produk berbeda dengan baris kontrak": "The product differs from the contract line",
  "Produk ganda dalam kontrak": "Duplicate product in the contract",
  "Pilih minimal satu baris": "Select at least one line",
  // ---- Stock opname & barcode ----
  "Baris dari stok sistem tidak bisa dihapus; isi hitungan 0 bila barang tidak ada":
    "Lines from system stock cannot be removed; count 0 if the item is missing",
  "Baris hitung tidak ditemukan": "Count line not found",
  "Hanya sesi draft atau batal yang bisa dihapus": "Only draft or cancelled sessions can be deleted",
  "Hanya sesi yang disetujui yang bisa dihitung ulang": "Only approved sessions can be recounted",
  "Kategori produk tidak ditemukan": "Product category not found",
  "Lokasi bukan milik gudang ini": "The location does not belong to this warehouse",
  "Lokasi di luar cakupan sesi opname": "The location is outside the count session's scope",
  "Pilih produk atau lot untuk dicetak labelnya": "Select products or lots to print labels for",
  "Produk ini ber-lot/serial: scan nomor lot/serialnya":
    "This product is lot/serial tracked: scan its lot/serial number",
  "Produk ini bukan produk stok": "This product is not a stockable product",
  "Selisih opname belum disetujui": "The count variance has not been approved",
  "Sesi stock opname tidak ditemukan": "Stock count session not found",
  "Sesi sudah dimulai": "The session has already started",
  "Sesi tidak sedang dalam tahap hitung": "The session is not in the counting stage",
  "Sesi yang sudah diposting atau dibatalkan tidak bisa dibatalkan":
    "Posted or cancelled sessions cannot be cancelled",
  'Barcode "{}" tidak dikenali': 'Barcode "{0}" not recognized',
  "Masih ada {} baris yang belum dihitung; isi atau anggap nol":
    "{0} lines are still uncounted; fill them in or treat them as zero",
  "Kuantitas tidak valid (maks. 4 desimal, tidak negatif)":
    "Invalid quantity (max. 4 decimals, not negative)",
  "Teks barcode hanya boleh karakter ASCII cetak (maks. 80)":
    "Barcode text may only contain printable ASCII characters (max. 80)",
  // ---- Manufaktur ----
  "BOM berputar: salah satu komponen memakai produk jadi ini":
    "Circular BOM: a component uses this finished product",
  "BOM berputar (komponen memuat produk jadinya sendiri)":
    "Circular BOM (a component contains its own finished product)",
  "BOM kit/phantom tidak diproduksi lewat order produksi":
    "Kit/phantom BOMs are not produced through production orders",
  "BOM sudah dipakai order produksi; nonaktifkan saja":
    "The BOM is used by production orders; deactivate it instead",
  "BOM tidak ditemukan": "BOM not found",
  "BOM tidak ditemukan untuk produk ini": "BOM not found for this product",
  "Hanya order produksi draft atau batal yang bisa dihapus":
    "Only draft or cancelled production orders can be deleted",
  "Hanya order produksi draft yang bisa dikonfirmasi": "Only draft production orders can be confirmed",
  "Isi menit aktual": "Enter the actual minutes",
  "Isi nomor lot barang jadi": "Enter the lot number of the finished product",
  "Isi satu nomor serial unik untuk setiap unit": "Enter one unique serial number per unit",
  "Jumlah lot harus sama dengan kuantitas terpakai": "Lot quantities must equal the consumed quantity",
  "Komponen ganda dalam BOM": "Duplicate component in the BOM",
  "Komponen sama dengan produk jadi": "The component is the same as the finished product",
  "Minimal satu komponen": "At least one component",
  "Komponen tidak ditemukan": "Component not found",
  "Operasi sudah dimulai": "The operation has already started",
  "Operasi tidak ditemukan": "Operation not found",
  "Order produksi belum dikonfirmasi atau sudah selesai":
    "The production order is not confirmed or already done",
  "Order produksi tidak ditemukan": "Production order not found",
  "Order produksi yang selesai atau batal tidak bisa dibatalkan":
    "Done or cancelled production orders cannot be cancelled",
  "Produk ini belum punya BOM aktif": "This product has no active BOM",
  "Produk jadi harus produk stok": "The finished product must be a stockable product",
  "Produk jadi tidak boleh jasa": "The finished product cannot be a service",
  "Produk tidak ditemukan": "Product not found",
  "Stasiun kerja dipakai di BOM; nonaktifkan saja": "The work center is used in BOMs; deactivate it instead",
  "Stasiun kerja tidak ditemukan": "Work center not found",
  "Akun barang dalam proses & biaya konversi belum diatur di pengaturan akuntansi":
    "Work-in-progress and conversion cost accounts are not set in accounting settings",
  "Stok bahan tidak cukup: {}": "Not enough component stock: {0}",
  "Nomor serial {} sudah ada di stok": "Serial number {0} is already in stock",
  "Harus lebih dari 0": "Must be greater than 0",
  // ---- MRP ----
  "Hasil MRP tidak ditemukan": "MRP run not found",
  "Pilih minimal satu usulan": "Select at least one proposal",
  // ---- Field kustom ----
  "Model field kustom tidak dikenal": "Unknown custom field model",
  "Field kustom tidak ditemukan": "Custom field not found",
  "Field kustom tidak dikenal": "Unknown custom field",
  "Format field kustom tidak valid": "Invalid custom field format",
  "Kunci sudah dipakai di data ini": "This key is already used for this record type",
  "Tipe tidak bisa diubah karena sudah ada data yang mengisinya":
    "The type cannot be changed because records already have a value",
  "Wajib diisi": "Required",
  "Isi minimal satu pilihan": "Add at least one option",
  "Nilai pilihan tidak boleh ganda": "Option values must be unique",
  "Pilih jenis data yang dirujuk": "Choose the referenced record type",
  "Rujukan tidak bisa diberi nilai bawaan": "A reference cannot have a default value",
  "Maksimal {} karakter": "At most {0} characters",
  "Harus berupa angka": "Must be a number",
  "Harus ya atau tidak": "Must be yes or no",
  "Pilihan tidak dikenal": "Unknown option",
  "Pilihan tidak dikenal: {}": "Unknown option: {0}",
  "URL harus diawali http(s)://": "The URL must start with http(s)://",
  "Email tidak valid": "Invalid email",
  "Rujukan tidak valid": "Invalid reference",
  "Huruf kecil, angka, garis bawah; diawali huruf (maks. 40)":
    "Lowercase letters, digits, underscores; starts with a letter (max. 40)",
  // ---- Dashboard BI ----
  "Dashboard tidak ditemukan": "Dashboard not found",
  "Kirim salah satu: dashboardId, builtin, atau widgets":
    "Send exactly one of: dashboardId, builtin, or widgets",
  "Kirim salah satu: builtin atau dashboardId": "Send exactly one of: builtin or dashboardId",
  "Id widget ganda": "Duplicate widget id",
  "Judul widget wajib diisi": "Widget title is required",
  // Aturan otomatis
  "Model tidak dikenal": "Unknown model",
  "Aturan otomatis tidak ditemukan": "Automation rule not found",
  "Pilih data untuk menguji aturan ini": "Pick a record to test this rule",
  "Field tidak dikenal": "Unknown field",
  "Pilih kolom tanggal": "Pick a date field",
  "Data ini tidak punya penanggung jawab": "This record has no responsible user",
  "Field tidak bisa diubah aturan otomatis": "This field cannot be changed by automation",
  "Pilih kolom angka": "Pick a number field",
  "Data ini tidak punya kontak": "This record has no contact",
  "Pilih frekuensi": "Pick a frequency",
  "Pilih hari": "Pick a day",
  "Pilih tanggal": "Pick a date",
  "Isi alamat email": "Enter an email address",
  "Pilih penerima": "Pick recipients",
  "URL tidak valid": "Invalid URL",
  "Tambahkan minimal satu aksi": "Add at least one action",
  // Maintenance
  "Stok {} di lokasi ini hanya {}": "Only {1} of {0} in stock at this location",
  "Peralatan sudah punya riwayat perawatan; ubah status menjadi Tidak dipakai":
    "The equipment has maintenance history; set its status to Retired instead",
  "Permintaan perawatan tidak ditemukan": "Maintenance request not found",
  "Permintaan yang selesai/batal tidak dapat diubah": "Done or cancelled requests cannot be changed",
  "Vendor/biaya jasa sudah ditagihkan dan tidak dapat diubah":
    "The vendor/service cost is already billed and cannot change",
  "Permintaan ini tidak bisa dimulai": "This request cannot be started",
  "Permintaan sudah selesai/batal": "The request is already done or cancelled",
  "Permintaan selesai tidak dapat dibatalkan": "A done request cannot be cancelled",
  "Permintaan yang sudah ditagihkan tidak dapat dibatalkan": "A billed request cannot be cancelled",
  "Suku cadang permintaan selesai/batal tidak dapat diubah":
    "Spare parts of a done or cancelled request cannot change",
  "Tagihan untuk permintaan ini sudah dibuat": "A bill for this request already exists",
  "Permintaan batal tidak dapat ditagihkan": "A cancelled request cannot be billed",
  "Membuat tagihan memerlukan hak akuntansi (tulis)": "Creating a bill requires accounting write access",
  "Peralatan tidak ditemukan": "Equipment not found",
  "Isi interval hari atau interval meter": "Enter a day interval or a meter interval",
  "Peralatan sudah tidak dipakai": "The equipment is retired",
  "Waktu selesai sebelum waktu mulai": "Finish time is before start time",
  "Pilih lokasi stok suku cadang": "Choose a stock location for spare parts",
  "Biaya jasa vendor harus lebih dari 0": "Vendor service cost must be greater than 0",
  "Peralatan ini tidak memakai meter": "This equipment does not use a meter",
  "Meter tidak boleh mundur (sekarang {})": "The meter cannot go backwards (currently {0})",
  // Mutu
  "Pemeriksaan mutu tidak ditemukan": "Quality check not found",
  "Pemeriksaan sudah diputuskan": "The check has already been decided",
  "Lengkapi semua butir pemeriksaan dulu": "Complete every check item first",
  "Akun selisih persediaan belum diatur di pengaturan akuntansi":
    "The stock adjustment account is not set in the accounting settings",
  "Catatan ketidaksesuaian tidak ditemukan": "Non-conformance not found",
  "Pemasok hanya untuk titik kontrol penerimaan": "A supplier only applies to receipt control points",
  "Isi nilai sampel": "Enter the sample value",
  "Jumlah hasil tidak sesuai butir pemeriksaan": "The number of results does not match the check items",
  "Butir pemeriksaan tidak ditemukan": "Check item not found",
  "Foto maksimal 2 MB": "Photos are limited to 2 MB",
  "Pemeriksaan tidak lulus; pilih terima bersyarat, retur, atau scrap":
    "The check failed; choose conditional acceptance, return, or scrap",
  "Retur hanya untuk barang dari penerimaan pemasok": "Returns only apply to goods received from a supplier",
  "Isi tindakan perbaikan sebelum menutup NCR": "Enter the corrective action before closing the NCR",
  "Batas maksimum lebih kecil dari minimum": "The maximum is lower than the minimum",
  "Isi nama butir pemeriksaan": "Enter the check item name",
  "Tambahkan minimal satu butir pemeriksaan": "Add at least one check item",
  "Tidak punya akses ke riwayat data ini": "You do not have access to this record's history",
  "URL harus http atau https": "URL must be http or https",
  "URL tidak boleh memuat nama pengguna/sandi": "URL must not contain a username or password",
  "URL harus https": "URL must be https",
  "URL mengarah ke alamat internal": "URL points to an internal address",
  "Butuh hak Data pribadi sensitif untuk mengubah data pribadi":
    "The Sensitive personal data permission is required to change personal data",
  "Butuh hak Gaji & kompensasi untuk melihat data ini":
    "The Salary & compensation permission is required to view this data",
  "Butuh hak Gaji & kompensasi untuk mengubah gaji":
    "The Salary & compensation permission is required to change salaries",
  "Lead ini sudah menjadi peluang": "This lead is already an opportunity",
  "Pilih kontak": "Select a contact",
  "Produk hanya untuk peluang; konversi lead ini dulu":
    "Products are for opportunities only; convert this lead first",
  "Peluang sudah ditutup": "The opportunity is already closed",
  "Lead tidak bisa digabung dengan dirinya sendiri": "A lead cannot be merged with itself",
  "Lead duplikat tidak ditemukan": "Duplicate lead not found",
  'Lead "{}" sudah ditutup': 'Lead "{0}" is already closed',
  "Penawaran hanya bisa dibuat dari peluang yang masih terbuka":
    "A quotation can only be created from an open opportunity",
  "Isi pelanggan pada peluang sebelum membuat penawaran":
    "Set the customer on the opportunity before creating a quotation",
  "Tambahkan produk pada peluang sebelum membuat penawaran":
    "Add products to the opportunity before creating a quotation",
  "Periode harus berformat YYYY-MM atau YYYY-Qn": "The period must be in YYYY-MM or YYYY-Qn format",
  "Hanya pemimpin tim atau pengelola CRM yang boleh menyesuaikan forecast":
    "Only a team leader or CRM manager may adjust the forecast",
  "Wilayah tidak ditemukan": "Territory not found",
  "Bulan harus berformat YYYY-MM": "The month must be in YYYY-MM format",
  "Isi salesperson atau tim, salah satu": "Set either a salesperson or a team, not both",
};
