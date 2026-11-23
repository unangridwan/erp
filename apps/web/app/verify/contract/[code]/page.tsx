"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  SIGN_METHOD_LABEL,
  SIGN_STATE_LABEL,
  signStatePill,
} from "../../../../components/hr/contract-document";
import type { SignMethod, SignState } from "../../../../components/hr/contract-document";
import { API_URL } from "../../../../lib/api";
import { formatDate } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";

interface Result {
  number: string;
  title: string | null;
  company: string;
  employee: string;
  contractType: string;
  contractTypeName: string | null;
  dateStart: string;
  dateEnd: string | null;
  cancelled: boolean;
  signState: SignState;
  signMethod: SignMethod | null;
  documentHash: string | null;
  signatures: { role: "company" | "employee"; signerName: string; signedAt: string; intact: boolean }[];
}

/** Verifikasi publik keaslian kontrak kerja dari kode yang tercetak di PDF (tanpa login). */
export default function VerifyContractPage() {
  const { code } = useParams<{ code: string }>();
  const { l, locale } = useI18n();
  const [result, setResult] = useState<Result | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/public/contracts/verify/${encodeURIComponent(code)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Result>) : Promise.reject(new Error(String(r.status)))))
      .then(setResult, () => setFailed(true));
  }, [code]);

  const time = (iso: string) =>
    `${formatDate(iso, locale)} ${new Date(iso).toLocaleTimeString(locale === "en" ? "en-GB" : "id-ID", {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  const valid = result && !result.cancelled && result.signatures.every((s) => s.intact);

  return (
    <main className="verify-card">
      <section className="panel">
        <h1>{l("Verifikasi kontrak kerja", "Employment contract verification")}</h1>
        <p className="muted">
          {l("Kode verifikasi", "Verification code")}: <strong>{code.toUpperCase()}</strong>
        </p>
        {failed && (
          <p className="error" role="alert">
            {l(
              "Kode verifikasi tidak dikenal. Periksa kembali kode pada dokumen.",
              "Unknown verification code. Check the code on the document again.",
            )}
          </p>
        )}
        {!result && !failed && <p className="muted">{l("Memeriksa…", "Checking…")}</p>}
        {result && (
          <>
            <p>
              <span className={`pill ${valid ? "ok" : "bad"}`}>
                {valid
                  ? l("Dokumen terdaftar & sah", "Document registered & valid")
                  : result.cancelled
                    ? l("Kontrak dibatalkan", "Contract cancelled")
                    : l("Isi dokumen telah berubah setelah ditandatangani", "Document changed after signing")}
              </span>{" "}
              <span className={`pill ${signStatePill(result.signState)}`}>
                {l(...SIGN_STATE_LABEL[result.signState])}
              </span>
            </p>
            <dl className="facts">
              <div>
                <dt>{l("Nomor", "Number")}</dt>
                <dd>{result.number}</dd>
              </div>
              <div>
                <dt>{l("Dokumen", "Document")}</dt>
                <dd>{result.title ?? result.contractTypeName ?? result.contractType.toUpperCase()}</dd>
              </div>
              <div>
                <dt>{l("Perusahaan", "Company")}</dt>
                <dd>{result.company}</dd>
              </div>
              <div>
                <dt>{l("Karyawan", "Employee")}</dt>
                <dd>{result.employee}</dd>
              </div>
              <div>
                <dt>{l("Periode", "Period")}</dt>
                <dd>
                  {formatDate(result.dateStart, locale)} –{" "}
                  {result.dateEnd ? formatDate(result.dateEnd, locale) : l("tidak terbatas", "open-ended")}
                </dd>
              </div>
              {result.signMethod && (
                <div>
                  <dt>{l("Cara tanda tangan", "Signing method")}</dt>
                  <dd>{l(...SIGN_METHOD_LABEL[result.signMethod])}</dd>
                </div>
              )}
              {result.documentHash && (
                <div className="wide">
                  <dt>{l("Hash dokumen (SHA-256)", "Document hash (SHA-256)")}</dt>
                  <dd>
                    <code style={{ overflowWrap: "anywhere" }}>{result.documentHash}</code>
                  </dd>
                </div>
              )}
            </dl>
            {result.signatures.length > 0 && (
              <>
                <h2>{l("Penandatangan", "Signatories")}</h2>
                <ul className="activity-list">
                  {result.signatures.map((s) => (
                    <li key={s.role}>
                      <span className={`pill ${s.intact ? "ok" : "bad"}`}>
                        {s.role === "company" ? l("Perusahaan", "Company") : l("Karyawan", "Employee")}
                      </span>
                      <span>
                        {s.signerName} · {time(s.signedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p className="muted small">
              {l(
                "Halaman ini hanya menampilkan data inti untuk memastikan keaslian dokumen; isi kontrak, gaji, dan data pribadi tidak ditampilkan.",
                "This page shows only core data to confirm the document is genuine; the contract text, wage, and personal data are not shown.",
              )}
            </p>
          </>
        )}
      </section>
    </main>
  );
}
