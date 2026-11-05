"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { download } from "../../../../../components/accounting/download";
import {
  ApprovalRequestForm,
  FIELD_LABEL,
  REQUEST_BADGE,
  REQUEST_STATE_LABEL,
  type ApprovalCategory,
  type FieldKey,
} from "../../../../../components/hr/approval-request-form";
import { FpkOpeningButton } from "../../../../../components/hr/recruitment-extras";
import { useMe } from "../../../../../components/me-context";
import { api, ApiError } from "../../../../../lib/api";
import { formatDate, money } from "../../../../../lib/format";
import { useI18n } from "../../../../../lib/i18n";
import { can } from "../../../../../lib/resources";
import { ask } from "../../../../../components/feedback";

interface Step {
  id: string;
  sequence: number;
  approverName: string | null;
  approverUserId: string | null;
  label: string | null;
  required: boolean;
  state: "pending" | "approved" | "refused" | "skipped";
  decidedByName: string | null;
  delegated: boolean;
  decidedAt: string | null;
  note: string | null;
}
interface Request {
  id: string;
  number: string | null;
  subject: string;
  state: string;
  categoryId: string;
  requesterName: string | null;
  date: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  quantity: string | null;
  amount: string | null;
  reference: string | null;
  location: string | null;
  contact: string | null;
  description: string | null;
  hasAttachment: boolean;
  attachmentName: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  category: ApprovalCategory & { approvalMode: "sequential" | "parallel"; minApprovals: number };
  steps: Step[];
  can: { edit: boolean; submit: boolean; cancel: boolean; decide: boolean };
}

const STEP_STATE: Record<Step["state"], [string, string]> = {
  pending: ["menunggu", "pending"],
  approved: ["disetujui", "approved"],
  refused: ["ditolak", "refused"],
  skipped: ["dilewati", "skipped"],
};

/** Detail permintaan persetujuan: isian, lampiran, tahap persetujuan, ajukan/batal/setujui/tolak. */
export default function ApprovalRequestPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { l, tx, locale } = useI18n();
  const me = useMe();
  const [request, setRequest] = useState<Request | null>(null);
  const [categories, setCategories] = useState<ApprovalCategory[]>([]);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api<Request>(`/approval-requests/${id}`).then(setRequest, (e: Error) => setError(e.message));
  useEffect(() => {
    void load();
    api<ApprovalCategory[]>("/approval-categories?active=1").then(setCategories, () => setCategories([]));
  }, [id]);

  async function act(path: string, body: object = {}) {
    setError(null);
    try {
      setRequest(await api<Request>(`/approval-requests/${id}/${path}`, { method: "POST", body }));
      setNote("");
    } catch (e) {
      setError(
        e instanceof ApiError
          ? [e.message, ...Object.values(e.fieldErrors)].filter(Boolean).join(" — ")
          : String(e),
      );
    }
  }
  async function remove() {
    if (!(await ask(l("Hapus draft ini?", "Delete this draft?")))) return;
    try {
      await api(`/approval-requests/${id}`, { method: "DELETE" });
      router.push("/hr/approval-requests?tab=mine");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!request) return <p className="muted">{error ?? l("Memuat…", "Loading…")}</p>;
  const f = request.category.fields;
  const shown = (k: FieldKey) => (f[k] ?? "none") !== "none";
  const value = (k: FieldKey): string | null => {
    switch (k) {
      case "date":
        return request.date ? formatDate(request.date, locale) : null;
      case "period":
        return request.dateFrom
          ? `${formatDate(request.dateFrom, locale)} – ${formatDate(request.dateTo, locale)}`
          : null;
      case "amount":
        return request.amount ? money(request.amount, locale) : null;
      case "quantity":
        return request.quantity ? String(Number(request.quantity)) : null;
      case "attachment":
        return null;
      default:
        return request[k];
    }
  };
  const editableCategories = categories.some((c) => c.id === request.categoryId)
    ? categories
    : [request.category, ...categories];

  return (
    <div className="panel">
      <header className="toolbar">
        <h1>
          {request.number ?? l("Draft", "Draft")} — {request.subject}
        </h1>
        <span className={`badge ${REQUEST_BADGE[request.state] ?? ""}`}>
          {tx(REQUEST_STATE_LABEL[request.state]!)}
        </span>
        {request.category.code === "FPK" &&
          request.state === "approved" &&
          can(me.permissions, "hr.manage") && <FpkOpeningButton requestId={request.id} />}
        {request.can.edit && !editing && (
          <>
            <button type="button" onClick={() => setEditing(true)}>
              {l("Ubah", "Edit")}
            </button>
            <button type="button" className="primary" onClick={() => act("submit")}>
              {l("Ajukan", "Submit")}
            </button>
            <button type="button" className="link" onClick={remove}>
              {l("Hapus", "Delete")}
            </button>
          </>
        )}
        {request.can.cancel && !editing && (
          <button
            type="button"
            className="danger"
            onClick={async () =>
              (await ask(l("Batalkan permintaan ini?", "Cancel this request?"))) && act("cancel")
            }
          >
            {l("Batalkan", "Cancel")}
          </button>
        )}
      </header>
      {error && <p className="error">{error}</p>}
      <p className="muted">
        {request.category.name} · {l("Pemohon", "Requester")}: {request.requesterName ?? "—"}
        {request.submittedAt &&
          ` · ${l("diajukan", "submitted")} ${formatDate(request.submittedAt.slice(0, 10), locale)}`}
      </p>
      {editing ? (
        <ApprovalRequestForm
          categories={editableCategories}
          requestId={request.id}
          initial={{
            categoryId: request.categoryId,
            subject: request.subject,
            date: request.date ?? "",
            dateFrom: request.dateFrom ?? "",
            dateTo: request.dateTo ?? "",
            quantity: request.quantity ? String(Number(request.quantity)) : "",
            amount: request.amount ? String(Number(request.amount)) : "",
            reference: request.reference ?? "",
            location: request.location ?? "",
            contact: request.contact ?? "",
            description: request.description ?? "",
            attachmentName: request.attachmentName,
          }}
          onSaved={() => {
            setEditing(false);
            void load();
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <dl className="details">
          {(Object.keys(FIELD_LABEL) as FieldKey[])
            .filter((k) => shown(k) && k !== "attachment")
            .map((k) => (
              <div key={k}>
                <dt>{tx(FIELD_LABEL[k])}</dt>
                <dd>{value(k) ?? "—"}</dd>
              </div>
            ))}
          {(shown("attachment") || request.hasAttachment) && (
            <div>
              <dt>{tx(FIELD_LABEL.attachment)}</dt>
              <dd>
                {request.hasAttachment ? (
                  <button
                    type="button"
                    className="link"
                    onClick={() =>
                      download(
                        `/approval-requests/${request.id}/attachment`,
                        request.attachmentName ?? "lampiran",
                      ).catch((e: Error) => setError(e.message))
                    }
                  >
                    {request.attachmentName ?? l("Unduh", "Download")}
                  </button>
                ) : (
                  "—"
                )}
              </dd>
            </div>
          )}
        </dl>
      )}

      {request.steps.length > 0 && (
        <>
          <h2>{l("Tahap persetujuan", "Approval steps")}</h2>
          <p className="muted">
            {request.category.approvalMode === "parallel"
              ? l(
                  "Paralel: penyetuju boleh memutuskan dalam urutan apa pun.",
                  "Parallel: approvers may decide in any order.",
                )
              : l(
                  "Berurutan: tahap berikutnya terbuka setelah tahap sebelumnya disetujui.",
                  "Sequential: the next step opens once the previous one is approved.",
                )}
            {request.category.minApprovals > 0 &&
              ` ${l(`Minimal ${request.category.minApprovals} persetujuan.`, `At least ${request.category.minApprovals} approvals.`)}`}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>{l("Penyetuju", "Approver")}</th>
                  <th>{l("Status", "Status")}</th>
                  <th>{l("Diputuskan", "Decided")}</th>
                  <th>{l("Catatan", "Note")}</th>
                </tr>
              </thead>
              <tbody>
                {request.steps.map((s) => (
                  <tr key={s.id}>
                    <td>{s.sequence}</td>
                    <td>
                      {s.approverName ?? l("HR", "HR")}
                      {s.label && <span className="muted"> · {s.label}</span>}
                      {!s.required && <span className="muted"> ({l("opsional", "optional")})</span>}
                    </td>
                    <td>{l(...STEP_STATE[s.state])}</td>
                    <td>
                      {s.decidedByName && (
                        <>
                          {s.decidedByName}
                          {s.delegated && ` (${l("delegasi", "delegate")})`}
                          {s.decidedAt && ` · ${formatDate(s.decidedAt.slice(0, 10), locale)}`}
                        </>
                      )}
                    </td>
                    <td>{s.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {request.can.decide && (
        <div className="inline-panel">
          <label className="field">
            <span>{l("Catatan", "Note")}</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <button type="button" className="primary" onClick={() => act("approve", { note: note || null })}>
            {l("Setujui", "Approve")}
          </button>
          <button type="button" className="danger" onClick={() => act("refuse", { note: note || null })}>
            {l("Tolak", "Refuse")}
          </button>
        </div>
      )}
    </div>
  );
}
