import Link from "next/link";

/** Halaman 404 mengikuti tema aplikasi (bukan halaman hitam bawaan Next.js). */
export default function NotFound() {
  return (
    <main className="not-found">
      <strong>404</strong>
      <p>Halaman tidak ditemukan · Page not found</p>
      <p>
        <Link href="/">Kembali ke beranda · Back to home</Link>
      </p>
    </main>
  );
}
