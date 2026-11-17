import { redirect } from "next/navigation";

/** Kategori persetujuan kini diatur di Pengaturan › Aturan Persetujuan (tab Kategori & dokumen sistem). */
export default function LegacyApprovalCategories() {
  redirect("/settings/approval-rules?tab=categories");
}
