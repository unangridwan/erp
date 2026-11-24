"use client";

import { FLOW_DEFS, FLOW_PROCESSES, type FlowProcess } from "@erp/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "../../../../components/feedback";
import { api, ApiError } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";

interface Row {
  stage: string;
  label: [string, string];
  defaultSlaDays: number | null;
  slaDays: number | null;
  departmentId: string | null;
  final: boolean;
}

/** Pengaturan SLA (hari) & departemen penanggung jawab tiap tahap alur bisnis. */
export default function FlowSettingsPage() {
  const { l } = useI18n();
  const [process, setProcess] = useState<FlowProcess>("o2c");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ items: { id: string; name: string }[] } | { id: string; name: string }[]>(
      "/departments?limit=200",
    ).then(
      (r) => setDepartments(Array.isArray(r) ? r : r.items),
      () => setDepartments([]),
    );
  }, []);
  useEffect(() => {
    setRows(null);
    setError(null);
    api<Row[]>(`/flow/${process}/settings`).then(setRows, (e: Error) => setError(e.message));
  }, [process]);

  async function save() {
    if (!rows) return;
    setSaving(true);
    try {
      const saved = await api<Row[]>(`/flow/${process}/settings`, {
        method: "PUT",
        body: {
          stages: rows
            .filter((r) => !r.final || r.departmentId)
            .map((r) => ({
              stage: r.stage,
              slaDays: r.final ? null : r.slaDays,
              departmentId: r.departmentId,
            })),
        },
      });
      setRows(saved);
      toast.success(l("Pengaturan alur disimpan.", "Flow settings saved."));
    } catch (e) {
      toast.error(e instanceof ApiError ? (Object.values(e.fieldErrors)[0] ?? e.message) : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <header className="toolbar control-panel">
        <div className="cp-left">
          <nav className="breadcrumb">
            <Link href="/flow">{l("Alur Bisnis", "Business Flow")}</Link>
            <span>/</span>
            <h1>{l("Pengaturan SLA", "SLA settings")}</h1>
          </nav>
          <button
            className="primary"
            disabled={saving || !rows}
            aria-busy={saving}
            onClick={() => void save()}
          >
            {l("Simpan", "Save")}
          </button>
        </div>
      </header>
      <p className="muted">
        {l(
          "Batas waktu (hari) tiap tahap menentukan kapan dokumen dianggap berisiko (≥ 80%) atau terlambat. Bila dokumen punya batas sendiri (jadwal kirim, jatuh tempo), batas dokumen yang dipakai. Departemen penanggung jawab dipakai di papan serah terima.",
          "Each stage's time limit (days) decides when a document is at risk (≥ 80%) or late. When a document has its own deadline (delivery date, due date), that deadline is used instead. The responsible department is used on the handoff board.",
        )}
      </p>
      <div className="tabs" role="tablist">
        {FLOW_PROCESSES.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={process === p}
            className={process === p ? "active" : ""}
            onClick={() => setProcess(p)}
          >
            {l(...FLOW_DEFS[p].label)}
          </button>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!rows && !error && <p className="muted">{l("Memuat…", "Loading…")}</p>}
      {rows && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l("Tahap", "Stage")}</th>
                <th>{l("SLA (hari)", "SLA (days)")}</th>
                <th>{l("Departemen penanggung jawab", "Responsible department")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.stage}>
                  <td>{l(...r.label)}</td>
                  <td>
                    {r.final ? (
                      <span className="muted">{l("Tahap akhir", "Final stage")}</span>
                    ) : (
                      <input
                        inputMode="numeric"
                        aria-label={`SLA ${l(...r.label)}`}
                        value={r.slaDays ?? ""}
                        placeholder={String(r.defaultSlaDays ?? "")}
                        onChange={(e) => {
                          const n = e.target.value.replace(/\D/g, "");
                          setRows(
                            rows.map((x, j) =>
                              j === i
                                ? { ...x, slaDays: n === "" ? r.defaultSlaDays : Math.min(3650, Number(n)) }
                                : x,
                            ),
                          );
                        }}
                      />
                    )}
                  </td>
                  <td>
                    <select
                      aria-label={`${l("Departemen", "Department")} ${l(...r.label)}`}
                      value={r.departmentId ?? ""}
                      onChange={(e) =>
                        setRows(
                          rows.map((x, j) => (j === i ? { ...x, departmentId: e.target.value || null } : x)),
                        )
                      }
                    >
                      <option value="">—</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
