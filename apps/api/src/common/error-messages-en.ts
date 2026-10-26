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
  "Ekspor BPPU, BPMP, dan BPA1 dalam berkas terpisah": "Export BPPU, BPMP, and BPA1 in separate files",
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
  "Upah maksimum di bawah upah minimum": "The maximum wage is below the minimum wage",
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
};
