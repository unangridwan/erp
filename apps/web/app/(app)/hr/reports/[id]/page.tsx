import { redirect } from "next/navigation";

/** Pembuat Laporan pindah ke aplikasi Laporan & Dashboard. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  redirect(`/bi/reports/${(await params).id}`);
}
