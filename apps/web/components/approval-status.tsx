"use client";

import Link from "next/link";
import { useI18n } from "../lib/i18n";

export interface ApprovalInfo {
  required: boolean;
  request: { id: string; number: string | null; state: string } | null;
}

/** Dokumen boleh diproses (posting/terapkan/kirim): persetujuan tidak diwajibkan atau sudah disetujui. */
export const approvalCleared = (a: ApprovalInfo | undefined | null) =>
  !a?.required || a.request?.state === "approved";

/**
 * Status persetujuan dokumen (payroll run, mutasi, penawaran) + tombol "Ajukan persetujuan" bila diwajibkan dan
 * belum diajukan / ditolak / dibatalkan.
 */
export function ApprovalStatus({
  approval,
  onSubmit,
  busy,
  canSubmit = true,
}: {
  approval: ApprovalInfo | undefined | null;
  onSubmit: () => void;
  busy?: boolean;
  canSubmit?: boolean;
}) {
  const { l } = useI18n();
  if (!approval?.required) return null;
  const req = approval.request;
  const state = req?.state;
  const LABEL: Record<string, string> = {
    draft: l("Draft", "Draft"),
    submitted: l("Menunggu persetujuan", "Awaiting approval"),
    approved: l("Disetujui", "Approved"),
    refused: l("Ditolak", "Refused"),
    cancel: l("Dibatalkan", "Cancelled"),
  };
  const open = !req || state === "refused" || state === "cancel";
  return (
    <span className="approval-status">
      {req ? (
        <Link href={`/hr/approval-requests/${req.id}`}>
          <span className={`pill${state === "approved" ? " ok" : state === "refused" ? " bad" : " warn"}`}>
            {LABEL[state ?? ""] ?? state} {req.number}
          </span>
        </Link>
      ) : (
        <span className="pill warn">{l("Perlu persetujuan", "Approval required")}</span>
      )}
      {open && canSubmit && (
        <button type="button" disabled={busy} aria-busy={busy} onClick={onSubmit}>
          {l("Ajukan persetujuan", "Submit for approval")}
        </button>
      )}
    </span>
  );
}
