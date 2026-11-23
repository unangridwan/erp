"use client";

import { APPROVAL_LIMIT_DOCS, APPROVAL_RULE_DOCS, APPROVER_TYPE_LABELS } from "@erp/shared";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { money } from "../../lib/format";
import { useI18n } from "../../lib/i18n";

type Text2 = readonly [string, string];

/** Label jenis dokumen (alur atau batas). */
export function docLabel(doc: string): Text2 {
  return (
    (APPROVAL_RULE_DOCS as Record<string, { label: Text2 }>)[doc]?.label ??
    (APPROVAL_LIMIT_DOCS as Record<string, Text2>)[doc] ?? [doc, doc]
  );
}

interface Summary {
  limits: {
    docType: string;
    effective?: number | null;
    maxAmount?: string | null;
    source?: "user" | "role" | "default";
    categoryName?: string | null;
  }[];
  rules: {
    docType: string;
    sequence: number;
    approverType: keyof typeof APPROVER_TYPE_LABELS;
    minValue: string | null;
    label: string | null;
    roleName: string | null;
  }[];
  categories: {
    categoryId: string;
    categoryName: string;
    label: string | null;
    minAmount: string | null;
    roleName: string | null;
  }[];
}

/** Tab "Persetujuan" di detail pengguna/peran: batas wewenang & tahap di mana ia penyetuju. */
export function ApprovalSummary({ url }: { url: string }) {
  const { l, locale } = useI18n();
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Summary>(url).then(setData, (e: Error) => setError(e.message));
  }, [url]);
  if (error)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  if (!data) return <p className="muted">{l("Memuat…", "Loading…")}</p>;
  const amount = (v: number | string | null | undefined) =>
    v === null || v === undefined ? l("Tanpa batas", "Unlimited") : money(v, locale, 0);
  const source = {
    user: l("khusus akun", "account"),
    role: l("dari peran", "from role"),
    default: "default",
  };
  return (
    <div className="stack-wide">
      <section>
        <h3>{l("Batas wewenang", "Approval limits")}</h3>
        {data.limits.length ? (
          <div className="table-wrap">
            <table>
              <tbody>
                {data.limits.map((x, i) => (
                  <tr key={i}>
                    <td>
                      {l(...docLabel(x.docType))}
                      {x.categoryName && <span className="muted"> · {x.categoryName}</span>}
                    </td>
                    <td className="num">{amount(x.effective !== undefined ? x.effective : x.maxAmount)}</td>
                    {x.source && <td className="muted">{source[x.source]}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">
            {l("Belum ada batas wewenang yang diatur.", "No approval limits configured.")}
          </p>
        )}
      </section>
      <section>
        <h3>{l("Tahap persetujuan", "Approval steps")}</h3>
        {data.rules.length || data.categories.length ? (
          <ul className="plain-list">
            {data.rules.map((r, i) => (
              <li key={`r${i}`}>
                <strong>{l(...docLabel(r.docType))}</strong> ·{" "}
                {r.label ?? l(...(APPROVER_TYPE_LABELS[r.approverType] as readonly [string, string]))}
                {r.minValue && (
                  <span className="muted"> · ≥ {Number(r.minValue).toLocaleString(locale)}</span>
                )}
                {r.roleName && (
                  <span className="muted">
                    {" "}
                    · {l("lewat peran", "via role")} {r.roleName}
                  </span>
                )}
              </li>
            ))}
            {data.categories.map((c, i) => (
              <li key={`c${i}`}>
                <strong>{c.categoryName}</strong>
                {c.label && ` · ${c.label}`}
                {c.minAmount && <span className="muted"> · ≥ {money(c.minAmount, locale, 0)}</span>}
                {c.roleName && (
                  <span className="muted">
                    {" "}
                    · {l("lewat peran", "via role")} {c.roleName}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            {l(
              "Tidak ditunjuk langsung sebagai penyetuju (bisa tetap menyetujui sebagai atasan).",
              "Not assigned directly as an approver (may still approve as a manager).",
            )}
          </p>
        )}
      </section>
    </div>
  );
}
