import { redirect } from "next/navigation";

/** /settings tidak punya halaman sendiri: arahkan ke halaman pertama Pengaturan. */
export default function SettingsIndex() {
  redirect("/settings/users");
}
