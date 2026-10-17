"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { download } from "../../../../../components/accounting/download";
import { useOptions } from "../../../../../components/accounting/use-options";
import { useMe } from "../../../../../components/me-context";
import { api, ApiError } from "../../../../../lib/api";
import { money } from "../../../../../lib/format";
import { useI18n } from "../../../../../lib/i18n";
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
  annual: { biayaJabatan: string; neto: string; ptkp: string; pkp: string; tax: string } | null;
  run: { id: string; name: string; periodStart: string; state: string };
  employee: { name: string; employeeNumber: string; departmentName: string | null; jobName: string | null };
  lines: { id: string; code: string; name: string; category: string; amount: string }[];
  inputs: { componentId: string; amount: string; description: string | null }[];
}

const EARN = ["basic", "allowance", "overtime", "unpaid"];
const DEDUCT = ["bpjs_employee", "tax", "deduction"];

/** Slip gaji: rincian pendapatan, potongan, iuran perusahaan, perhitungan PPh 21, dan input tidak tetap. */
export default function PayslipPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const { l, locale } = useI18n();
  const components = useOptions<{ id: string; code: string; name: string; kind: string }>(
    can(me.permissions, "payroll.write") ? "/salary-components" : null,
  );
  const [slip, setSlip] = useState<Slip | null>(null);
  const [inputs, setInputs] = useState<{ componentId: string; amount: string; description: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = (s: Slip) => {
    setSlip(s);
    setInputs(
      s.inputs.map((i) => ({
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
        {section(l("Potongan", "Deductions"), DEDUCT, -1)}
        {section(l("Iuran perusahaan (tidak memotong gaji)", "Employer contributions"), ["bpjs_employer"])}
      </div>
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
      {editable && (
        <>
          <h2>
            {l(
              "Komponen tidak tetap bulan ini (THR, bonus, potongan)",
              "One-off items this month (THR, bonus, deductions)",
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
