"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { download } from "../../../../../components/accounting/download";
import { useOptions } from "../../../../../components/accounting/use-options";
import { useMe } from "../../../../../components/me-context";
import { api, ApiError } from "../../../../../lib/api";
import { money } from "../../../../../lib/format";
import { L, useI18n } from "../../../../../lib/i18n";
import { can } from "../../../../../lib/resources";

interface Slip {
  id: string;
  ptkpStatus: string;
  terCategory: string;
  terRate: string | null;
  isFinal: boolean;
  hasNpwp: boolean;
  gross: string;
  pph21: string;
  net: string;
  kesEmployee: string;
  kesEmployer: string;
  tkEmployee: string;
  tkEmployer: string;
  bpjsKesWage: string;
  bpjsTkWage: string;
  annual: { biayaJabatan: string; neto: string; ptkp: string; pkp: string; tax: string } | null;
  run: { id: string; name: string; periodStart: string; state: string };
  employee: { name: string; employeeNumber: string; departmentName: string | null; jobName: string | null };
  lines: { id: string; code: string; name: string; category: string; amount: string }[];
  inputs: {
    componentId: string;
    componentName: string;
    amount: string;
    description: string | null;
    source: "manual" | "thr" | "retro";
  }[];
}

const EARN = ["basic", "allowance", "overtime", "unpaid"];
const DEDUCT = ["tax", "deduction"];

/** Rincian per program: BPJS Kesehatan dan BPJS Ketenagakerjaan tidak digabung. */
const PROGRAMS = [
  {
    key: "kes" as const,
    title: L("BPJS Kesehatan", "BPJS Health"),
    rows: [[L("Jaminan Kesehatan", "Health insurance"), "BPJS_KES_EE", "BPJS_KES_ER"]],
  },
  {
    key: "tk" as const,
    title: L("BPJS Ketenagakerjaan", "BPJS Employment"),
    rows: [
      [L("Jaminan Hari Tua (JHT)", "Old-age savings (JHT)"), "JHT_EE", "JHT_ER"],
      [L("Jaminan Kecelakaan Kerja (JKK)", "Work accident (JKK)"), null, "JKK"],
      [L("Jaminan Kematian (JKM)", "Death benefit (JKM)"), null, "JKM"],
      [L("Jaminan Pensiun (JP)", "Pension (JP)"), "JP_EE", "JP_ER"],
    ],
  },
] as const;

/** Slip gaji: rincian pendapatan, potongan, iuran perusahaan, perhitungan PPh 21, dan input tidak tetap. */
export default function PayslipPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const { l, tx, locale } = useI18n();
  const components = useOptions<{ id: string; code: string; name: string; kind: string }>(
    can(me.permissions, "payroll.write") ? "/salary-components" : null,
  );
  const [slip, setSlip] = useState<Slip | null>(null);
  const [inputs, setInputs] = useState<{ componentId: string; amount: string; description: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = (s: Slip) => {
    setSlip(s);
    setInputs(
      s.inputs
        .filter((i) => i.source === "manual")
        .map((i) => ({
          componentId: i.componentId,
          amount: String(Number(i.amount)),
          description: i.description ?? "",
        })),
    );
  };
  useEffect(() => {
    api<Slip>(`/payslips/${id}`)
      .then(load)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  async function saveInputs() {
    setError(null);
    try {
      load(
        await api<Slip>(`/payslips/${id}/inputs`, {
          method: "PUT",
          body: {
            inputs: inputs
              .filter((i) => i.componentId)
              .map((i) => ({ ...i, description: i.description || null })),
          },
        }),
      );
    } catch (e) {
      setError(e instanceof ApiError ? (Object.values(e.fieldErrors)[0] ?? e.message) : String(e));
    }
  }

  if (!slip) return <p className="muted">{error ?? l("Memuat…", "Loading…")}</p>;
  const n = (v: string) => money(v, locale);
  const editable = slip.run.state === "draft" && can(me.permissions, "payroll.write");
  const section = (title: string, cats: string[], sign = 1) => {
    const rows = slip.lines.filter((x) => cats.includes(x.category));
    return (
      <section>
        <h2>{title}</h2>
        <table>
          <tbody>
            {rows.map((x) => (
              <tr key={x.id}>
                <td>{x.name}</td>
                <td className="num">{n(String(sign * Number(x.amount)))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th>{l("Total", "Total")}</th>
              <th className="num">{n(String(rows.reduce((s, x) => s + sign * Number(x.amount), 0)))}</th>
            </tr>
          </tfoot>
        </table>
      </section>
    );
  };

  return (
    <div className="panel">
      <header className="toolbar">
        <h1>
          {slip.employee.name} <small className="muted">{slip.employee.employeeNumber}</small>
        </h1>
        <Link href={`/payroll/runs/${slip.run.id}`}>{slip.run.name}</Link>
        <button
          type="button"
          onClick={() =>
            download(`/payslips/${id}/pdf`, `slip-${slip.employee.employeeNumber}.pdf`).catch((e: Error) =>
              setError(e.message),
            )
          }
        >
          PDF
        </button>
      </header>
      {error && <p className="error">{error}</p>}
      <div className="split">
        {section(l("Pendapatan", "Earnings"), EARN)}
        <section>
          <h2>{l("Potongan", "Deductions")}</h2>
          <table>
            <tbody>
              <tr>
                <td>{l("BPJS Kesehatan (karyawan)", "BPJS Health (employee)")}</td>
                <td className="num">{n(slip.kesEmployee)}</td>
              </tr>
              <tr>
                <td>{l("BPJS Ketenagakerjaan (karyawan)", "BPJS Employment (employee)")}</td>
                <td className="num">{n(slip.tkEmployee)}</td>
              </tr>
              {slip.lines
                .filter((x) => DEDUCT.includes(x.category))
                .map((x) => (
                  <tr key={x.id}>
                    <td>{x.name}</td>
                    <td className="num">{n(String(-Number(x.amount)))}</td>
                  </tr>
                ))}
            </tbody>
            <tfoot>
              <tr>
                <th>{l("Total", "Total")}</th>
                <th className="num">
                  {n(
                    String(
                      Number(slip.kesEmployee) +
                        Number(slip.tkEmployee) -
                        slip.lines
                          .filter((x) => DEDUCT.includes(x.category))
                          .reduce((t, x) => t + Number(x.amount), 0),
                    ),
                  )}
                </th>
              </tr>
            </tfoot>
          </table>
        </section>
      </div>
      <div className="split">
        {PROGRAMS.map((program) => {
          const amount = (code: string | null) =>
            code ? Math.abs(Number(slip.lines.find((x) => x.code === code)?.amount ?? 0)) : 0;
          const rows = program.rows.filter(([, ee, er]) => amount(ee) || amount(er));
          const wage = program.key === "kes" ? slip.bpjsKesWage : slip.bpjsTkWage;
          return (
            <section key={program.key}>
              <h2>{tx(program.title)}</h2>
              <p className="muted">
                {l("Dasar upah", "Wage base")}: {n(wage)}
              </p>
              <table>
                <thead>
                  <tr>
                    <th>{l("Program", "Programme")}</th>
                    <th className="num">{l("Karyawan", "Employee")}</th>
                    <th className="num">{l("Perusahaan", "Employer")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(([label, ee, er]) => (
                    <tr key={er}>
                      <td>{tx(label)}</td>
                      <td className="num">{n(String(amount(ee)))}</td>
                      <td className="num">{n(String(amount(er)))}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={3} className="muted">
                        {l("Tidak terdaftar sebagai peserta", "Not enrolled")}
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <th>{l("Subtotal", "Subtotal")}</th>
                    <th className="num">{n(program.key === "kes" ? slip.kesEmployee : slip.tkEmployee)}</th>
                    <th className="num">{n(program.key === "kes" ? slip.kesEmployer : slip.tkEmployer)}</th>
                  </tr>
                </tfoot>
              </table>
            </section>
          );
        })}
      </div>
      <p className="muted">
        {l(
          "Iuran perusahaan dibayar perusahaan dan tidak memotong gaji.",
          "Employer contributions are paid by the company and do not reduce pay.",
        )}
      </p>
      <p className="notice">
        <strong>
          {l("Gaji bersih", "Net pay")}: {n(slip.net)}
        </strong>
      </p>
      <h2>{l("Perhitungan PPh 21", "PPh 21 computation")}</h2>
      {slip.isFinal && slip.annual ? (
        <dl className="totals">
          <dt>{l("Biaya jabatan setahun", "Annual job expense")}</dt>
          <dd>{n(slip.annual.biayaJabatan)}</dd>
          <dt>{l("Penghasilan neto setahun", "Annual net income")}</dt>
          <dd>{n(slip.annual.neto)}</dd>
          <dt>PTKP ({slip.ptkpStatus})</dt>
          <dd>{n(slip.annual.ptkp)}</dd>
          <dt>PKP</dt>
          <dd>{n(slip.annual.pkp)}</dd>
          <dt>{l("PPh 21 setahun (Pasal 17)", "Annual PPh 21 (Art. 17)")}</dt>
          <dd>{n(slip.annual.tax)}</dd>
          <dt>{l("PPh 21 masa ini (setahun − sudah dipotong)", "This period (annual − withheld)")}</dt>
          <dd>{n(slip.pph21)}</dd>
        </dl>
      ) : (
        <p>
          {l("Metode TER kategori", "TER category")} {slip.terCategory} · {l("tarif", "rate")}{" "}
          {Number(slip.terRate ?? 0)}% × {l("bruto", "gross")} {n(slip.gross)} ={" "}
          <strong>{n(slip.pph21)}</strong>
          {!slip.hasNpwp && (
            <span className="error"> {l("(tanpa NPWP/NIK: tarif +20%)", "(no NPWP/NIK: +20%)")}</span>
          )}
        </p>
      )}
      {slip.inputs.some((i) => i.source !== "manual") && (
        <>
          <h2>{l("Dihitung otomatis", "Computed automatically")}</h2>
          <ul>
            {slip.inputs
              .filter((i) => i.source !== "manual")
              .map((i) => (
                <li key={i.componentId + i.source}>
                  {i.source === "thr" ? "THR" : l("Rapel", "Back pay")}: {i.componentName}
                  {i.description ? ` — ${i.description}` : ""} · <strong>{n(i.amount)}</strong>
                </li>
              ))}
          </ul>
          {editable && (
            <p className="muted">
              {l(
                "Hitung ulang lewat tombol Hitung THR / Hitung rapel di halaman payroll.",
                "Recompute with the Compute THR / Compute back pay buttons on the payroll page.",
              )}
            </p>
          )}
        </>
      )}
      {editable && (
        <>
          <h2>
            {l(
              "Komponen tidak tetap bulan ini (bonus, potongan)",
              "One-off items this month (bonus, deductions)",
            )}
          </h2>
          <table className="lines">
            <tbody>
              {inputs.map((x, i) => (
                <tr key={i}>
                  <td>
                    <select
                      value={x.componentId}
                      onChange={(e) =>
                        setInputs((rs) =>
                          rs.map((r, j) => (j === i ? { ...r, componentId: e.target.value } : r)),
                        )
                      }
                    >
                      <option value="">—</option>
                      {components.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} — {c.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className="num"
                      inputMode="decimal"
                      value={x.amount}
                      onChange={(e) =>
                        setInputs((rs) => rs.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)))
                      }
                    />
                  </td>
                  <td>
                    <input
                      placeholder={l("Keterangan", "Description")}
                      value={x.description}
                      onChange={(e) =>
                        setInputs((rs) =>
                          rs.map((r, j) => (j === i ? { ...r, description: e.target.value } : r)),
                        )
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="link"
                      onClick={() => setInputs((rs) => rs.filter((_, j) => j !== i))}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>
                  <button
                    type="button"
                    className="link"
                    onClick={() =>
                      setInputs((rs) => [...rs, { componentId: "", amount: "0", description: "" }])
                    }
                  >
                    + {l("Tambah", "Add")}
                  </button>{" "}
                  <button type="button" className="primary" onClick={saveInputs}>
                    {l("Simpan & hitung ulang", "Save & recompute")}
                  </button>
                </td>
              </tr>
            </tfoot>
          </table>
        </>
      )}
    </div>
  );
}
