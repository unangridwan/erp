"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { errorText } from "../../../../../components/hr/hr-panels";
import { RefSelect } from "../../../../../components/ref-select";
import { api } from "../../../../../lib/api";
import { formatDate, money } from "../../../../../lib/format";
import { useI18n } from "../../../../../lib/i18n";

interface Training {
  id: string;
  name: string;
  provider: string | null;
  dateStart: string;
  dateEnd: string;
  cost: string;
  certificateValidMonths: number | null;
  state: string;
  participants: {
    id: string;
    employeeId: string;
    employeeName: string;
    employeeNumber: string;
    state: "enrolled" | "completed" | "absent";
    certificateExpiry: string | null;
    certificateDocumentId: string | null;
  }[];
}

const readFile = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/** Pelatihan: peserta, hasil (selesai/tidak hadir), sertifikat → dokumen karyawan dengan masa berlaku. */
export default function TrainingPage() {
  const { id } = useParams<{ id: string }>();
  const { l, locale } = useI18n();
  const [t, setT] = useState<Training | null>(null);
  const [employeeId, setEmployeeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () => api<Training>(`/trainings/${id}`).then(setT, (e) => setError(errorText(e))),
    [id],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const call = async (path: string, method: string, body?: object) => {
    setError(null);
    try {
      const r = await api<Training | null>(`/trainings/${id}${path}`, { method, body });
      if (r) setT(r);
      else void load();
    } catch (e) {
      setError(errorText(e));
    }
  };
  if (!t) return <p className="muted">{error ?? l("Memuat…", "Loading…")}</p>;

  return (
    <div className="panel">
      <header className="toolbar">
        <h1>
          {t.name} {t.provider && <small className="muted">{t.provider}</small>}
        </h1>
        <Link href="/hr/trainings">{l("Semua pelatihan", "All trainings")}</Link>
      </header>
      <p className="muted">
        {formatDate(t.dateStart, locale)} – {formatDate(t.dateEnd, locale)} · {money(t.cost, locale)}
        {t.certificateValidMonths
          ? ` · ${l(`sertifikat berlaku ${t.certificateValidMonths} bulan`, `certificate valid ${t.certificateValidMonths} months`)}`
          : ""}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="inline-panel">
        <label className="field">
          <span>{l("Tambah peserta", "Add participant")}</span>
          <RefSelect
            name="employeeId"
            resource="employees"
            display="name"
            value={employeeId}
            onChange={setEmployeeId}
          />
        </label>
        <button
          type="button"
          className="primary"
          disabled={!employeeId}
          onClick={() => {
            void call("/participants", "POST", { employeeIds: [employeeId] });
            setEmployeeId("");
          }}
        >
          {l("Tambah", "Add")}
        </button>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{l("Peserta", "Participant")}</th>
              <th>{l("Hasil", "Result")}</th>
              <th>{l("Sertifikat", "Certificate")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {t.participants.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/employees/${p.employeeId}`}>{p.employeeName}</Link>{" "}
                  <small className="muted">{p.employeeNumber}</small>
                </td>
                <td>
                  <select
                    aria-label={l("Hasil", "Result")}
                    value={p.state}
                    onChange={(e) => call(`/participants/${p.id}`, "PUT", { state: e.target.value })}
                  >
                    <option value="enrolled">{l("Terdaftar", "Enrolled")}</option>
                    <option value="completed">{l("Selesai/lulus", "Completed")}</option>
                    <option value="absent">{l("Tidak hadir", "Absent")}</option>
                  </select>
                </td>
                <td>
                  {p.certificateDocumentId ? (
                    <span>
                      {l("tersimpan di dokumen", "stored in documents")}
                      {p.certificateExpiry
                        ? ` · ${l("berlaku s.d.", "valid until")} ${formatDate(p.certificateExpiry, locale)}`
                        : ""}
                    </span>
                  ) : p.state === "completed" ? (
                    <input
                      type="file"
                      accept="application/pdf,image/jpeg,image/png"
                      aria-label={l("Unggah sertifikat", "Upload certificate")}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (file.size > 5 * 1024 * 1024)
                          return setError(l("Berkas maksimal 5 MB", "Files may be at most 5 MB"));
                        await call(`/participants/${p.id}`, "PUT", {
                          state: "completed",
                          certificate: { name: file.name, type: file.type, data: await readFile(file) },
                        });
                      }}
                    />
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    className="link"
                    onClick={() => call(`/participants/${p.id}`, "DELETE")}
                  >
                    {l("Hapus", "Remove")}
                  </button>
                </td>
              </tr>
            ))}
            {t.participants.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  {l("Belum ada peserta.", "No participants yet.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
