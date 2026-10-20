"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";
import { money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";

interface Report {
  grades: {
    code: string | null;
    name: string | null;
    minWage: string | null;
    maxWage: string | null;
    employees: number;
    lowest: string;
    highest: string;
    average: string;
    outOfRange: number;
  }[];
  items: {
    employeeId: string;
    employeeNumber: string;
    name: string;
    jobName: string | null;
    wage: string;
    grade: { code: string; name: string } | null;
    minWage: string | null;
    maxWage: string | null;
    position: "below" | "within" | "above" | null;
  }[];
}

/** Struktur & skala upah (PP 36/2021): upah pokok kontrak berjalan per golongan jabatan. */
export default function WageScalePage() {
  const { l, locale } = useI18n();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Report>("/hr/wage-scale")
      .then(setReport)
      .catch((e: Error) => setError(e.message));
  }, []);
  const n = (v: string | null) => (v === null ? "—" : money(v, locale));
  const POSITION = {
    below: l("di bawah skala", "below range"),
    within: l("sesuai", "within range"),
    above: l("di atas skala", "above range"),
  };

  return (
    <div className="panel">
      <header className="toolbar">
        <h1>{l("Struktur & Skala Upah", "Wage Structure & Scale")}</h1>
        <Link href="/salary-grades">{l("Kelola golongan", "Manage grades")}</Link>
      </header>
      <p className="muted">
        {l(
          "Wajib disusun pengusaha (PP 36/2021). Golongan dipasang di jabatan; upah pokok kontrak bulanan berjalan dibandingkan rentang golongannya.",
          "Required of employers (PP 36/2021). Grades are set on job positions; running monthly contract wages are compared with the grade range.",
        )}
      </p>
      {error && <p className="error">{error}</p>}
      {report && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{l("Golongan", "Grade")}</th>
                  <th className="num">{l("Rentang", "Range")}</th>
                  <th className="num">{l("Karyawan", "Employees")}</th>
                  <th className="num">{l("Terendah", "Lowest")}</th>
                  <th className="num">{l("Rata-rata", "Average")}</th>
                  <th className="num">{l("Tertinggi", "Highest")}</th>
                  <th className="num">{l("Di luar rentang", "Out of range")}</th>
                </tr>
              </thead>
              <tbody>
                {report.grades.map((g) => (
                  <tr key={g.code ?? ""}>
                    <td>{g.code ? `${g.code} · ${g.name}` : l("(jabatan tanpa golongan)", "(no grade)")}</td>
                    <td className="num">{g.code ? `${n(g.minWage)} – ${n(g.maxWage)}` : "—"}</td>
                    <td className="num">{g.employees}</td>
                    <td className="num">{n(g.lowest)}</td>
                    <td className="num">{n(g.average)}</td>
                    <td className="num">{n(g.highest)}</td>
                    <td className="num">
                      {g.outOfRange ? <strong className="error">{g.outOfRange}</strong> : 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2>{l("Per karyawan", "Per employee")}</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{l("Karyawan", "Employee")}</th>
                  <th>{l("Jabatan", "Job")}</th>
                  <th>{l("Golongan", "Grade")}</th>
                  <th className="num">{l("Upah pokok", "Base wage")}</th>
                  <th>{l("Posisi", "Position")}</th>
                </tr>
              </thead>
              <tbody>
                {report.items.map((i) => (
                  <tr key={i.employeeId}>
                    <td>
                      <Link href={`/employees/${i.employeeId}`}>{i.name}</Link>{" "}
                      <small className="muted">{i.employeeNumber}</small>
                    </td>
                    <td>{i.jobName ?? "—"}</td>
                    <td>{i.grade?.code ?? "—"}</td>
                    <td className="num">{n(i.wage)}</td>
                    <td className={i.position && i.position !== "within" ? "error" : undefined}>
                      {i.position ? POSITION[i.position] : "—"}
                    </td>
                  </tr>
                ))}
                {report.items.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      {l("Belum ada kontrak bulanan berjalan.", "No running monthly contracts yet.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
