"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AdvanceList } from "../../../../components/hr/advances";
import { useMe } from "../../../../components/me-context";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

/**
 * Kasbon karyawan: pengajuan (HR atas nama karyawan atau dari portal), persetujuan lewat mesin persetujuan (kategori
 * KASBON), pencairan, dan penyelesaian dengan klaim pertanggungjawaban; sisa dikembalikan atau dipotong gaji.
 */
function AdvancesPage() {
  const me = useMe();
  const { l } = useI18n();
  const search = useSearchParams();
  return (
    <>
      <header className="toolbar">
        <h1>{l("Kasbon Karyawan", "Employee Cash Advances")}</h1>
      </header>
      <p className="muted">
        {l(
          "Alur: ajukan → disetujui atasan & penyetuju kategori KASBON → cairkan (Dr Uang Muka Karyawan) → karyawan membuat klaim pertanggungjawaban → selesaikan: klaim dibebankan, selisih dibayar ke karyawan, sisa dikembalikan tunai atau dipotong di payroll berikutnya.",
          "Flow: request → approved by the manager & KASBON approvers → disburse (Dr Employee Advances) → the employee files settlement claims → settle: claims are expensed, any excess is paid to the employee, and the remainder is returned in cash or deducted on the next payroll.",
        )}
      </p>
      <AdvanceList
        canCreate={can(me.permissions, "hr.write")}
        chooseEmployee
        manage={can(me.permissions, "payroll.manage")}
        initialOpen={search.get("id")}
      />
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <AdvancesPage />
    </Suspense>
  );
}
