"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BENEFIT_KIND_LABEL } from "@erp/shared";
import {
  BenefitEnrollments,
  planValue,
  type BenefitPlan,
} from "../../../../../components/payroll/benefits-panel";
import { api } from "../../../../../lib/api";
import { money } from "../../../../../lib/format";
import { useI18n } from "../../../../../lib/i18n";

/** Detail paket benefit: ketentuan iuran & daftar peserta. */
export default function BenefitPlanPage() {
  const { id } = useParams<{ id: string }>();
  const { l, locale } = useI18n();
  const [p, setP] = useState<(BenefitPlan & { provider?: string | null }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<BenefitPlan>(`/benefit-plans/${id}`)
      .then(setP)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  if (!p) return <p className={error ? "error" : "muted"}>{error ?? l("Memuat…", "Loading…")}</p>;
  return (
    <>
      <header className="toolbar">
        <nav className="breadcrumb">
          <Link href="/payroll/benefits">{l("Paket Benefit", "Benefit Plans")}</Link>
          <span>/</span>
          <h1>{p.name}</h1>
        </nav>
      </header>
      <section className="panel stack proj-panel">
        <dl className="o-dl">
          <dt>{l("Kode", "Code")}</dt>
          <dd>{p.code}</dd>
          <dt>{l("Jenis", "Kind")}</dt>
          <dd>
            {l(...BENEFIT_KIND_LABEL[p.kind])}
            {!p.active && <span className="pill warn"> {l("Nonaktif", "Inactive")}</span>}
          </dd>
          <dt>{l("No. polis", "Policy no.")}</dt>
          <dd>{p.policyNo ?? "—"}</dd>
          <dt>{l("Porsi perusahaan", "Employer portion")}</dt>
          <dd>
            {planValue(p.calc, p.employerAmount, locale)}
            {p.taxable && (
              <small className="muted"> · {l("natura (objek PPh 21)", "in kind (PPh 21 taxable)")}</small>
            )}
          </dd>
          <dt>{l("Porsi karyawan", "Employee portion")}</dt>
          <dd>{planValue(p.calc, p.employeeAmount, locale)}</dd>
          {p.wageCap && (
            <>
              <dt>{l("Batas upah", "Wage cap")}</dt>
              <dd>{money(p.wageCap, locale)}</dd>
            </>
          )}
          <dt>{l("Per tanggungan", "Per dependent")}</dt>
          <dd>
            {money(p.dependentAmount, locale)}{" "}
            <small className="muted">
              ({p.dependentPayer === "employer" ? l("perusahaan", "employer") : l("karyawan", "employee")})
            </small>
          </dd>
        </dl>
      </section>
      <BenefitEnrollments planId={id} />
    </>
  );
}
