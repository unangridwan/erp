"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Dashboard SDM digabung ke Dashboard & Analitik SDM (tab Biaya & aktivitas); tautan lama tetap berfungsi. */
export default function HrDashboardPage() {
  const router = useRouter();
  useEffect(() => router.replace("/hr/analytics?tab=costs"), [router]);
  return null;
}
