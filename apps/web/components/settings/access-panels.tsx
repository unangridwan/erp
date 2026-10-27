"use client";

import { effectivePermissions, type AccessLevel } from "@erp/shared";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/i18n";

type Text2 = readonly [string, string];
export interface CatalogModule {
  key: string;
  label: Text2;
  levels: AccessLevel[];
  features: { key: string; label: Text2 }[];
  specials: { code: string; label: Text2 }[];
}
export interface RoleTemplate {
  code: string;
  name: Text2;
  description: Text2;
  permissions: string[];
}
export interface Catalog {
  modules: CatalogModule[];
  adminOnly: string[];
  templates: RoleTemplate[];
}

export const LEVEL_LABEL: Record<AccessLevel, Text2> = {
  read: ["Lihat", "View"],
  export: ["Ekspor", "Export"],
  write: ["Ubah", "Edit"],
  delete: ["Hapus", "Delete"],
  manage: ["Kelola", "Manage"],
};

export function useCatalog() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  useEffect(() => {
    void api<Catalog>("/permissions/catalog").then(setCatalog, () => setCatalog(null));
  }, []);
  return catalog;
}

/** Label manusiawi sebuah kode hak (Modul › Fitur › Aksi). */
export function usePermissionLabel(catalog: Catalog | null) {
  const { l } = useI18n();
  return (code: string) => {
    if (code === "*") return l("Administrator penuh (semua hak)", "Full administrator (all permissions)");
    const [m, a, b] = code.split(".");
    const mod = catalog?.modules.find((x) => x.key === m);
    if (!mod) return code;
    const special = mod.specials.find((s) => s.code === code);
    if (special) return `${l(...mod.label)} › ${l(...special.label)}`;
    const feature = b ? mod.features.find((f) => f.key === a) : null;
    const level = (b ?? a) as AccessLevel;
    const lv = LEVEL_LABEL[level] ? l(...LEVEL_LABEL[level]) : level;
    return feature ? `${l(...mod.label)} › ${l(...feature.label)} › ${lv}` : `${l(...mod.label)} › ${lv}`;
  };
}

/** Semua kode yang bisa dipilih (untuk hak khusus per akun). */
export function permissionOptions(catalog: Catalog) {
  return catalog.modules.flatMap((m) => [
    ...m.levels.map((lv) => `${m.key}.${lv}`),
    ...m.specials.map((s) => s.code),
    ...m.features.flatMap((f) => m.levels.map((lv) => `${m.key}.${f.key}.${lv}`)),
  ]);
}

/**
 * Matriks modul × fitur × aksi. Mode edit (peran): centang menyimpan kode; kotak yang sudah tercakup hak modul tampil
 * tercentang & terkunci. Mode baca (hak efektif): `value` = hak efektif, `sources` untuk tooltip asal hak.
 */
export function PermissionMatrix({
  catalog,
  value,
  onChange,
  sources,
  denied,
}: {
  catalog: Catalog;
  value: string[];
  onChange?: (next: string[]) => void;
  sources?: Record<string, string[]>;
  denied?: string[];
}) {
  const { l } = useI18n();
  const [query, setQuery] = useState("");
  const admin = value.includes("*");
  const implied = useMemo(
    () =>
      new Set(
        onChange
          ? effectivePermissions({ roles: [{ permissions: value, companyId: null }], overrides: [] }, "_")
          : value,
      ),
    [value, onChange],
  );
  const selected = new Set(value);
  const toggle = (code: string, on: boolean) => {
    if (!onChange) return;
    onChange(on ? [...new Set([...value, code])] : value.filter((c) => c !== code));
  };
  const box = (code: string) => {
    const explicit = selected.has(code);
    const has = admin || implied.has(code);
    const tip = sources?.[code]?.map((s) =>
      s.replace(/^role:/, l("Peran: ", "Role: ")).replace(/^grant:/, l("Hak khusus: ", "Grant: ")),
    );
    const isDenied = denied?.includes(code);
    return (
      <input
        type="checkbox"
        aria-label={code}
        checked={has}
        disabled={!onChange || admin || (has && !explicit)}
        title={isDenied ? l("Dicabut khusus untuk akun ini", "Revoked for this account") : tip?.join("\n")}
        onChange={(e) => toggle(code, e.target.checked)}
      />
    );
  };
  const q = query.trim().toLowerCase();
  const modules = catalog.modules.filter(
    (m) =>
      !q ||
      l(...m.label)
        .toLowerCase()
        .includes(q) ||
      m.features.some((f) =>
        l(...f.label)
          .toLowerCase()
          .includes(q),
      ),
  );
  return (
    <div className="perm-matrix">
      {admin && (
        <p className="notice">
          {l("Administrator penuh: semua hak.", "Full administrator: all permissions.")}
        </p>
      )}
      <input
        className="perm-search"
        placeholder={l("Cari modul atau fitur…", "Search module or feature…")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {modules.map((m) => (
        <details key={m.key} open={!!q}>
          <summary>
            <strong>{l(...m.label)}</strong>
            <span className="perm-levels">
              {m.levels.map((lv) => (
                <label key={lv}>
                  {box(`${m.key}.${lv}`)} {l(...LEVEL_LABEL[lv])}
                </label>
              ))}
            </span>
          </summary>
          {m.specials.length > 0 && (
            <div className="perm-specials">
              {m.specials.map((s) => (
                <label key={s.code}>
                  {box(s.code)} {l(...s.label)}
                </label>
              ))}
            </div>
          )}
          {m.features.length > 0 && (
            <div className="table-wrap">
              <table className="perm-table">
                <thead>
                  <tr>
                    <th>{l("Fitur", "Feature")}</th>
                    {m.levels.map((lv) => (
                      <th key={lv} className="num">
                        {l(...LEVEL_LABEL[lv])}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {m.features.map((f) => (
                    <tr key={f.key}>
                      <td>{l(...f.label)}</td>
                      {m.levels.map((lv) => (
                        <td key={lv} className="num">
                          {box(`${m.key}.${f.key}.${lv}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </details>
      ))}
    </div>
  );
}
