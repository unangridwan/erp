"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { DataTransferPanel } from "../../../../components/hr/data-transfer";

function Panel() {
  return <DataTransferPanel app="payroll" initialRunId={useSearchParams().get("runId") ?? ""} />;
}

/** Impor input variabel slip & ekspor rekap slip per periode payroll. */
export default function PayrollDataPage() {
  return (
    <Suspense>
      <Panel />
    </Suspense>
  );
}
