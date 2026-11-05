"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable, type DataColumn } from "../../../../components/data-table";
import { errorText } from "../../../../components/hr/hr-panels";
import { useMe } from "../../../../components/me-context";
import { api, ApiError } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";
import { PPH21_CATEGORY_LABEL, SEVERANCE_RULE_LABEL } from "@erp/shared";
import {
  invalidateContractTypes,
  type ContractPayroll,
  type ContractType,
} from "../../../../lib/use-contract-types";

type Row = ContractType & { usage: number };
interface Draft {
  id: string | null;
  isSystem: boolean;
  code: string;
  name: string;
  description: string;
  legalBasis: string;
  fixedTerm: boolean;
  maxMonths: string;
  documentTitle: string;
  sequence: string;
  active: boolean;
  payroll: ContractPayroll;
}

const DEFAULT_PAYROLL: ContractPayroll = {
  inPayroll: true,
  bpjsKes: true,
  bpjsJkk: true,
  bpjsJkm: true,
  bpjsJht: true,
  bpjsJp: true,
  pph21Category: "auto",
  thr: true,
  severance: "pesangon",
};
const BPJS_PROGRAMS: [keyof ContractPayroll, string, string][] = [
  ["bpjsKes", "BPJS Kesehatan", "BPJS Health"],
  ["bpjsJkk", "JKK (kecelakaan kerja)", "JKK (work accident)"],
  ["bpjsJkm", "JKM (kematian)", "JKM (death)"],
  ["bpjsJht", "JHT (hari tua)", "JHT (old age)"],
  ["bpjsJp", "JP (pensiun)", "JP (pension)"],
];

const blank: Draft = {
  id: null,
  isSystem: false,
  code: "",
  name: "",
  description: "",
  legalBasis: "",
  fixedTerm: false,
  maxMonths: "",
  documentTitle: "",
  sequence: "60",
  active: true,
  payroll: DEFAULT_PAYROLL,
};
const toDraft = (t: Row): Draft => ({
  id: t.id,
  isSystem: t.isSystem,
  code: t.code,
  name: t.name,
  description: t.description ?? "",
  legalBasis: t.legalBasis ?? "",
  fixedTerm: t.fixedTerm,
  maxMonths: t.maxMonths ? String(t.maxMonths) : "",
  documentTitle: t.documentTitle ?? "",
  sequence: String(t.sequence),
  active: t.active,
  payroll: {
    inPayroll: t.inPayroll,
    bpjsKes: t.bpjsKes,
    bpjsJkk: t.bpjsJkk,
    bpjsJkm: t.bpjsJkm,
    bpjsJht: t.bpjsJht,
    bpjsJp: t.bpjsJp,
    pph21Category: t.pph21Category,
    thr: t.thr,
    severance: t.severance,
  },
});

/**
 * Master jenis kontrak kerja (PKWT, PKWTT, harian lepas, magang, kemitraan, …): aturan tanggal berakhir & batas masa
 * kontrak dibaca dari sini saat kontrak/FPK/penawaran disimpan, sehingga perubahan peraturan cukup diubah di sini.
 */
export default function ContractTypesPage() {
  const { l } = useI18n();
  const me = useMe();
  const manage = can(me.permissions, "hr.manage");
  const [items, setItems] = useState<Row[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      api<Row[]>("/contract-types").then(
        (rows) => {
          invalidateContractTypes();
          setItems(rows);
        },
        (e) => setError(errorText(e)),
      ),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<void>, message: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    setErrors({});
    try {
      await fn();
      setNotice(message);
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const setPayroll = <K extends keyof ContractPayroll>(k: K, v: ContractPayroll[K]) =>
    setDraft((d) => (d ? { ...d, payroll: { ...d.payroll, [k]: v } } : d));
  const bpjsText = (t: ContractPayroll) => {
    const on = BPJS_PROGRAMS.filter(([k]) => t[k]).map(([k, id]) =>
      k === "bpjsKes" ? "Kes" : id.split(" ")[0],
    );
    return on.length ? `BPJS: ${on.join(", ")}` : l("Tanpa BPJS", "No BPJS");
  };
  const save = () =>
    run(
      async () => {
        const d = draft!;
        await api(d.id ? `/contract-types/${d.id}` : "/contract-types", {
          method: d.id ? "PUT" : "POST",
          body: {
            code: d.code,
            name: d.name,
            description: d.description || null,
            legalBasis: d.legalBasis || null,
            fixedTerm: d.fixedTerm,
            maxMonths: d.maxMonths ? Number(d.maxMonths) : null,
            documentTitle: d.documentTitle || null,
            sequence: d.sequence ? Number(d.sequence) : 10,
            active: d.active,
            ...d.payroll,
          },
        });
        setDraft(null);
        await load();
      },
      l("Jenis kontrak disimpan.", "Contract type saved."),
    );
  const remove = (t: Row) =>
    confirm(l(`Hapus jenis kontrak ${t.name}?`, `Delete contract type ${t.name}?`)) &&
    run(
      async () => {
        await api(`/contract-types/${t.id}`, { method: "DELETE" });
        setDraft(null);
        await load();
      },
      l("Jenis kontrak dihapus.", "Contract type deleted."),
    );

  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      {
        key: "name",
        label: l("Jenis kontrak", "Contract type"),
        value: (t) => t.name,
        render: (t) => (
          <>
            {manage ? (
              <button type="button" className="link" onClick={() => setDraft(toDraft(t))}>
                {t.name}
              </button>
            ) : (
              t.name
            )}
            {t.isSystem && (
              <>
                {" "}
                <span className="pill">{l("bawaan", "built-in")}</span>
              </>
            )}
            {t.description && (
              <>
                <br />
                <small className="muted">{t.description}</small>
              </>
            )}
          </>
        ),
      },
      { key: "code", label: l("Kode", "Code"), value: (t) => t.code },
      {
        key: "fixedTerm",
        label: l("Jangka waktu", "Term"),
        type: "enum",
        value: (t) => (t.fixedTerm ? "fixed" : "open"),
        optionLabel: (v) =>
          v === "fixed" ? l("Waktu tertentu", "Fixed term") : l("Tanpa batas", "Open-ended"),
        text: (t) =>
          t.fixedTerm
            ? l("Waktu tertentu (wajib tgl berakhir)", "Fixed term (end date required)")
            : l("Tanpa batas", "Open-ended"),
      },
      {
        key: "maxMonths",
        label: l("Maks. masa", "Max. length"),
        type: "number",
        className: "num",
        value: (t) => t.maxMonths,
        text: (t) => (t.maxMonths ? l(`${t.maxMonths} bulan`, `${t.maxMonths} months`) : "—"),
      },
      { key: "legalBasis", label: l("Dasar hukum", "Legal basis"), value: (t) => t.legalBasis },
      {
        key: "payroll",
        label: l("Penggajian", "Payroll"),
        type: "enum",
        value: (t) => (t.inPayroll ? "in" : "out"),
        optionLabel: (v) =>
          v === "in" ? l("Ikut payroll", "In payroll") : l("Tidak ikut payroll", "Not in payroll"),
        render: (t) =>
          t.inPayroll ? (
            <small>
              {bpjsText(t)}
              <br />
              <span className="muted">
                PPh 21: {l(...PPH21_CATEGORY_LABEL[t.pph21Category]).split(" (")[0]}
                {t.thr ? "" : ` · ${l("tanpa THR", "no THR")}`}
              </span>
            </small>
          ) : (
            <span className="pill">{l("Tidak ikut payroll", "Not in payroll")}</span>
          ),
      },
      {
        key: "usage",
        label: l("Dipakai", "Used by"),
        type: "number",
        className: "num",
        value: (t) => t.usage,
      },
      {
        key: "active",
        label: l("Status", "Status"),
        type: "enum",
        value: (t) => (t.active ? "active" : "inactive"),
        optionLabel: (v) => (v === "active" ? l("Aktif", "Active") : l("Nonaktif", "Inactive")),
        render: (t) => (
          <span className={`badge ${t.active ? "state-sale" : "state-cancel"}`}>
            {t.active ? l("Aktif", "Active") : l("Nonaktif", "Inactive")}
          </span>
        ),
      },
    ],
    [l, manage],
  );
  const fe = (k: string) => errors[k] && <small className="error">{errors[k]}</small>;
  const current = draft?.id ? items?.find((t) => t.id === draft.id) : undefined;

  return (
    <div className="stack-wide">
      <section className="panel">
        <header className="toolbar">
          <h1>{l("Jenis Kontrak", "Contract Types")}</h1>
          {manage && (
            <button type="button" onClick={() => setDraft({ ...blank })}>
              {l("Jenis baru", "New type")}
            </button>
          )}
        </header>
        <p className="muted">
          {l(
            "Jenis perjanjian kerja yang bisa dipilih di kontrak, FPK, penawaran kerja, dan template kontrak. Aturan “waktu tertentu” (wajib tanggal berakhir, ikut pengingat kontrak berakhir) dan batas masa kontrak diperiksa saat kontrak disimpan — ubah di sini bila peraturan berubah. Kode tersimpan di dokumen sehingga tidak bisa diganti; jenis yang sudah dipakai tidak bisa dihapus, nonaktifkan saja.",
            "Employment agreement types selectable on contracts, hiring requests, job offers and contract templates. The “fixed term” rule (end date required, included in expiry reminders) and the maximum contract length are checked when a contract is saved — change them here when regulations change. The code is stored on documents and cannot be changed; types in use cannot be deleted, deactivate them instead.",
          )}
        </p>
        {error && <p className="error">{error}</p>}
        {notice && <p className="success">{notice}</p>}
      </section>

      {draft && (
        <section className="panel">
          <h2>
            {draft.id
              ? draft.name || l("Ubah jenis kontrak", "Edit contract type")
              : l("Jenis kontrak baru", "New contract type")}
          </h2>
          <fieldset className="fields" disabled={busy}>
            <label className="field">
              <span>{l("Kode *", "Code *")}</span>
              <input
                value={draft.code}
                maxLength={20}
                readOnly={!!draft.id}
                placeholder={l("mis. borongan", "e.g. piecework")}
                onChange={(e) => set("code", e.target.value.toLowerCase())}
              />
              <small className="muted">
                {draft.id
                  ? l("Kode tidak bisa diubah.", "The code cannot be changed.")
                  : l("Huruf kecil, angka, - atau _ (2–20).", "Lowercase letters, digits, - or _ (2–20).")}
              </small>
              {fe("code")}
            </label>
            <label className="field">
              <span>{l("Nama *", "Name *")}</span>
              <input value={draft.name} maxLength={100} onChange={(e) => set("name", e.target.value)} />
              {fe("name")}
            </label>
            <label className="field wide">
              <span>{l("Keterangan", "Description")}</span>
              <input
                value={draft.description}
                maxLength={1000}
                onChange={(e) => set("description", e.target.value)}
              />
            </label>
            <label className="field">
              <span>{l("Dasar hukum / peraturan", "Legal basis / regulation")}</span>
              <input
                value={draft.legalBasis}
                maxLength={300}
                placeholder="PP 35/2021"
                onChange={(e) => set("legalBasis", e.target.value)}
              />
            </label>
            <label className="field">
              <span>{l("Judul dokumen bawaan", "Default document title")}</span>
              <input
                value={draft.documentTitle}
                maxLength={200}
                placeholder={l("mis. PERJANJIAN KERJA HARIAN LEPAS", "e.g. CASUAL WORK AGREEMENT")}
                onChange={(e) => set("documentTitle", e.target.value)}
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.fixedTerm}
                onChange={(e) => set("fixedTerm", e.target.checked)}
              />
              <span>
                {l(
                  "Waktu tertentu — wajib tanggal berakhir & ikut pengingat kontrak berakhir",
                  "Fixed term — end date required & included in expiry reminders",
                )}
              </span>
            </label>
            <label className="field">
              <span>{l("Batas masa kontrak (bulan)", "Maximum length (months)")}</span>
              <input
                type="number"
                min={1}
                max={600}
                value={draft.maxMonths}
                placeholder={l("kosong = tanpa batas", "empty = no limit")}
                onChange={(e) => set("maxMonths", e.target.value)}
              />
              {fe("maxMonths")}
            </label>
            <label className="field">
              <span>{l("Urutan", "Sequence")}</span>
              <input
                type="number"
                min={0}
                max={9999}
                value={draft.sequence}
                onChange={(e) => set("sequence", e.target.value)}
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.active}
                disabled={draft.isSystem}
                onChange={(e) => set("active", e.target.checked)}
              />
              <span>
                {l("Aktif (bisa dipilih di dokumen baru)", "Active (selectable on new documents)")}
                {draft.isSystem && ` — ${l("jenis bawaan selalu aktif", "built-in types are always active")}`}
              </span>
              {fe("active")}
            </label>
          </fieldset>
          <h3>{l("Penggajian & BPJS", "Payroll & BPJS")}</h3>
          <p className="muted small">
            {l(
              "Berlaku untuk semua karyawan dengan jenis kontrak ini. BPJS menjadi batas: iuran dipotong hanya bila program dicentang di sini DAN karyawan terdaftar di data karyawan.",
              "Applies to every employee on this contract type. BPJS acts as a limit: contributions are deducted only when the programme is ticked here AND the employee is enrolled in their record.",
            )}
          </p>
          <fieldset className="fields" disabled={busy}>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.payroll.inPayroll}
                onChange={(e) => setPayroll("inPayroll", e.target.checked)}
              />
              <span>{l("Ikut payroll (dibuatkan slip gaji)", "Included in payroll (gets a payslip)")}</span>
            </label>
            {draft.payroll.inPayroll && (
              <>
                <div className="field wide">
                  <span>{l("Program BPJS yang diikutkan", "BPJS programmes")}</span>
                  <span className="row-actions">
                    {BPJS_PROGRAMS.map(([key, id, en]) => (
                      <label key={key} className="check">
                        <input
                          type="checkbox"
                          checked={Boolean(draft.payroll[key])}
                          onChange={(e) => setPayroll(key, e.target.checked)}
                        />
                        <span>{l(id, en)}</span>
                      </label>
                    ))}
                  </span>
                </div>
                <label className="field">
                  <span>{l("Kategori PPh 21", "PPh 21 category")}</span>
                  <select
                    value={draft.payroll.pph21Category}
                    onChange={(e) =>
                      setPayroll("pph21Category", e.target.value as ContractPayroll["pph21Category"])
                    }
                  >
                    {Object.entries(PPH21_CATEGORY_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {l(...v)}
                      </option>
                    ))}
                  </select>
                  <small className="muted">
                    {l(
                      "Bukti potong A1/BPMP hanya untuk pegawai tetap.",
                      "A1/BPMP withholding slips are only for permanent employees.",
                    )}
                  </small>
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={draft.payroll.thr}
                    onChange={(e) => setPayroll("thr", e.target.checked)}
                  />
                  <span>{l("Berhak THR", "Entitled to THR")}</span>
                </label>
              </>
            )}
            <label className="field">
              <span>{l("Hak saat berakhir", "Entitlement at end")}</span>
              <select
                value={draft.payroll.severance}
                onChange={(e) => setPayroll("severance", e.target.value as ContractPayroll["severance"])}
              >
                {Object.entries(SEVERANCE_RULE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {l(...v)}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
          <div className="row-actions">
            <button type="button" className="primary" disabled={busy} onClick={save}>
              {l("Simpan", "Save")}
            </button>
            <button type="button" disabled={busy} onClick={() => setDraft(null)}>
              {l("Batal", "Cancel")}
            </button>
            {current && !current.isSystem && (
              <button
                type="button"
                className="danger"
                disabled={busy}
                title={
                  current.usage
                    ? l(
                        `Dipakai ${current.usage} dokumen — nonaktifkan saja`,
                        `Used by ${current.usage} documents — deactivate instead`,
                      )
                    : undefined
                }
                onClick={() => remove(current)}
              >
                {l("Hapus", "Delete")}
              </button>
            )}
          </div>
        </section>
      )}

      <section className="panel">
        {items ? (
          <DataTable
            rows={items}
            columns={columns}
            storageKey="contract-types"
            rowKey={(t) => t.id}
            searchPlaceholder={l("Cari jenis, kode, dasar hukum…", "Search type, code, legal basis…")}
            empty={l("Belum ada jenis kontrak.", "No contract types yet.")}
          />
        ) : (
          <p className="muted">{l("Memuat…", "Loading…")}</p>
        )}
      </section>
    </div>
  );
}
