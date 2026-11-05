"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { money } from "../../lib/format";
import { useI18n } from "../../lib/i18n";

export interface GradeWage {
  id: string;
  code: string;
  name: string;
  minWage: string;
  maxWage: string;
  baseWage: string | null;
}

/** Golongan upah karyawan: golongan di data karyawan, atau golongan jabatannya (sama seperti API). */
export function useEffectiveGrade(gradeId?: string | null, jobId?: string | null) {
  const [grade, setGrade] = useState<GradeWage | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        let id = gradeId || null;
        if (!id && jobId) id = (await api<{ gradeId: string | null }>(`/job-positions/${jobId}`)).gradeId;
        const g = id ? await api<GradeWage>(`/salary-grades/${id}`) : null;
        if (live) setGrade(g);
      } catch {
        if (live) setGrade(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [gradeId, jobId]);
  return grade;
}

/**
 * Isi gaji pokok dengan standar golongan saat golongan dipilih/berganti, selama user belum mengubahnya sendiri
 * (kosong atau masih sama dengan standar golongan sebelumnya).
 */
export function useGradeAutofill(
  grade: GradeWage | null,
  wage: string,
  wageType: string,
  setWage: (wage: string) => void,
) {
  const last = useRef<string | null>(null);
  const base = grade?.baseWage ?? null;
  useEffect(() => {
    if (wageType !== "monthly" || !base) return;
    if (wage === "" || (last.current !== null && Number(wage) === Number(last.current)))
      setWage(String(Number(base)));
    last.current = base;
    // Hanya saat standar golongan berubah; perubahan gaji oleh user tidak memicu isi ulang.
  }, [base, wageType]);
}

/** Keterangan di bawah gaji pokok: standar golongan, penanda "Disesuaikan" + tombol Pakai standar, peringatan skala. */
export function GradeWageHint({
  grade,
  wage,
  wageType,
  onUseStandard,
  editable = true,
}: {
  grade: GradeWage | null;
  wage: string;
  wageType: string;
  onUseStandard: (wage: string) => void;
  editable?: boolean;
}) {
  const { l, locale } = useI18n();
  if (!grade || wageType !== "monthly") return null;
  const value = wage === "" ? null : Number(wage);
  const base = grade.baseWage === null ? null : Number(grade.baseWage);
  const adjusted = base !== null && value !== null && value !== base;
  const outside = value !== null && (value < Number(grade.minWage) || value > Number(grade.maxWage));
  return (
    <span className="grade-wage-hint">
      {base !== null ? (
        <>
          <span className="muted">
            {l(`Standar golongan ${grade.code}:`, `Grade ${grade.code} standard:`)} {money(base, locale)}
          </span>
          {adjusted ? (
            <>
              <span className="pill warn">{l("Disesuaikan", "Adjusted")}</span>
              {editable && (
                <button type="button" className="link" onClick={() => onUseStandard(String(base))}>
                  {l("Pakai standar", "Use standard")}
                </button>
              )}
            </>
          ) : (
            value !== null && <span className="pill ok">{l("Sesuai standar", "Standard")}</span>
          )}
        </>
      ) : (
        <span className="muted">
          {l(
            `Golongan ${grade.code} belum punya gaji pokok standar.`,
            `Grade ${grade.code} has no standard base wage.`,
          )}{" "}
          <Link href={`/salary-grades/${grade.id}`}>{l("Atur", "Set")}</Link>
        </span>
      )}
      {outside && (
        <small className="error">
          {l(
            `Di luar skala upah golongan (${money(grade.minWage, locale)} – ${money(grade.maxWage, locale)}).`,
            `Outside the grade wage range (${money(grade.minWage, locale)} – ${money(grade.maxWage, locale)}).`,
          )}
        </small>
      )}
    </span>
  );
}
