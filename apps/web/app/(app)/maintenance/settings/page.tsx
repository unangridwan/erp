"use client";

import { useEffect, useState } from "react";
import { useOptions } from "../../../../components/accounting/use-options";
import { toast } from "../../../../components/feedback";
import { useMe } from "../../../../components/me-context";
import { api, ApiError } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

interface Settings {
  expenseAccountId: string | null;
  partsLocationId: string | null;
  defaultPartsLocationId: string | null;
}

/** Maintenance › Pengaturan: akun beban perawatan & lokasi suku cadang bawaan. */
export default function MaintenanceSettingsPage() {
  const { l } = useI18n();
  const me = useMe();
  const accounts = useOptions<{ id: string; code: string; name: string; accountType: string }>("/accounts");
  const locations = useOptions<{ id: string; completeName: string }>("/stock-locations?usage=internal");
  const [s, setS] = useState<Settings | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    api<Settings>("/maintenance/settings").then(setS, (e: Error) => toast.error(e.message));
  }, []);
  if (!s) return <p className="muted">{l("Memuat…", "Loading…")}</p>;
  const editable = can(me.permissions, "maintenance.manage");

  async function save() {
    setErrors({});
    try {
      await api("/maintenance/settings", {
        method: "PUT",
        body: { expenseAccountId: s!.expenseAccountId, partsLocationId: s!.partsLocationId },
      });
      toast.success(l("Pengaturan disimpan.", "Settings saved."));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      if (e instanceof ApiError) setErrors(e.fieldErrors);
    }
  }

  return (
    <>
      <header className="toolbar control-panel">
        <div className="cp-left">
          <h1>{l("Pengaturan Maintenance", "Maintenance Settings")}</h1>
        </div>
        <div className="cp-right">
          {editable && (
            <button type="button" className="primary" onClick={save}>
              {l("Simpan", "Save")}
            </button>
          )}
        </div>
      </header>
      <section className="panel">
        <div className="fields">
          <label className="field" data-field="expenseAccountId">
            <span>{l("Akun beban perawatan", "Maintenance expense account")}</span>
            <select
              value={s.expenseAccountId ?? ""}
              disabled={!editable}
              onChange={(e) => setS({ ...s, expenseAccountId: e.target.value || null })}
            >
              <option value="">
                {l(
                  "Otomatis: 6-8000 Beban Pemeliharaan dan Perbaikan",
                  "Automatic: 6-8000 Maintenance & Repairs",
                )}
              </option>
              {accounts
                .filter((a) => a.accountType.startsWith("expense"))
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} {a.name}
                  </option>
                ))}
            </select>
            {errors.expenseAccountId ? (
              <small className="error">{errors.expenseAccountId}</small>
            ) : (
              <small className="muted">
                {l(
                  "Dipakai untuk pemakaian suku cadang dan tagihan jasa vendor perawatan.",
                  "Used for spare parts consumption and maintenance vendor bills.",
                )}
              </small>
            )}
          </label>
          <label className="field" data-field="partsLocationId">
            <span>{l("Lokasi suku cadang bawaan", "Default spare parts location")}</span>
            <select
              value={s.partsLocationId ?? ""}
              disabled={!editable}
              onChange={(e) => setS({ ...s, partsLocationId: e.target.value || null })}
            >
              <option value="">{l("Gudang utama", "Main warehouse")}</option>
              {locations.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.completeName}
                </option>
              ))}
            </select>
            {errors.partsLocationId && <small className="error">{errors.partsLocationId}</small>}
          </label>
        </div>
      </section>
    </>
  );
}
