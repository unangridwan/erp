import { redirect } from "next/navigation";

/** Kategori persetujuan kini diatur di Pengaturan › Aturan Persetujuan. */
export default async function LegacyApprovalCategory({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/settings/approval-rules/categories/${id}`);
}
