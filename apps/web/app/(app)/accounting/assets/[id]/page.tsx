"use client";

import { TAX_ASSET_GROUPS } from "@erp/shared";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useOptions, type AccountOption } from "../../../../../components/accounting/use-options";
import { useMe } from "../../../../../components/me-context";
import { api, ApiError } from "../../../../../lib/api";
import { formatDate, money, today } from "../../../../../lib/format";
import { useI18n } from "../../../../../lib/i18n";
import { can } from "../../../../../lib/resources";

interface ScheduleLine {
  id: string;
  sequence: number;
  date: string;
  amount: string;
  accumulated: string;
  bookValue: string;
  moveId: string | null;
  moveName: string | null;
}
interface Asset {
  id: string;
  state: string;
  code: string | null;
  name: string;
  method: string;
  acquisitionDate: string;
  firstDepreciationDate: string;
  cost: string;
  salvageValue: string;
  usefulLifeMonths: number;
  assetAccountId: string;
  depreciationAccountId: string;
  expenseAccountId: string;
  schedule?: ScheduleLine[];
}

const GROUP_LABEL: Record<string, [string, string]> = {
  kelompok1: [
    "Kelompok 1 (4 th) — komputer, peralatan kantor",
    "Group 1 (4 yrs) — computers, office equipment",
  ],
  kelompok2: ["Kelompok 2 (8 th) — kendaraan, mebel", "Group 2 (8 yrs) — vehicles, furniture"],
  kelompok3: ["Kelompok 3 (16 th) — mesin industri", "Group 3 (16 yrs) — industrial machinery"],
  kelompok4: ["Kelompok 4 (20 th) — alat berat", "Group 4 (20 yrs) — heavy equipment"],
  bangunan_permanen: ["Bangunan permanen (20 th)", "Permanent building (20 yrs)"],
  bangunan_non_permanen: ["Bangunan non-permanen (10 th)", "Non-permanent building (10 yrs)"],
};

export default function AssetPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const router = useRouter();
  const me = useMe();
  const { l, locale } = useI18n();
  const accounts = useOptions<AccountOption>("/accounts");
  const byCode = (code: string) => accounts.find((a) => a.code === code)?.id ?? "";
  const [asset, setAsset] = useState<Asset | null>(null);
  const [values, setValues] = useState({
    code: "",
    name: "",
    method: "straight_line",
    acquisitionDate: today(),
    firstDepreciationDate: today(),
    cost: "",
    salvageValue: "0",
    usefulLifeMonths: "48",
    assetAccountId: "",
    depreciationAccountId: "",
    expenseAccountId: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (isNew) return;
    api<Asset>(`/assets/${id}/schedule`)
      .then((a) => {
        setAsset(a);
        setValues({
          code: a.code ?? "",
          name: a.name,
          method: a.method,
          acquisitionDate: a.acquisitionDate,
          firstDepreciationDate: a.firstDepreciationDate,
          cost: String(Number(a.cost)),
          salvageValue: String(Number(a.salvageValue)),
          usefulLifeMonths: String(a.usefulLifeMonths),
          assetAccountId: a.assetAccountId,
          depreciationAccountId: a.depreciationAccountId,
          expenseAccountId: a.expenseAccountId,
        });
      })
      .catch((e: Error) => setError(e.message));
  }, [id, isNew, version]);

  // Akun bawaan dari bagan akun standar untuk aset baru.
  useEffect(() => {
    if (!isNew || !accounts.length) return;
    setValues((v) => ({
      ...v,
      assetAccountId: v.assetAccountId || byCode("1-2100"),
      depreciationAccountId: v.depreciationAccountId || byCode("1-2190"),
      expenseAccountId: v.expenseAccountId || byCode("6-4000"),
    }));
  }, [accounts, isNew]); // byCode berasal dari accounts

  const editable = (isNew || asset?.state === "draft") && can(me.permissions, "accounting.write");
  const set = (k: keyof typeof values, v: string) => setValues((x) => ({ ...x, [k]: v }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    try {
      const body = {
        ...values,
        code: values.code || null,
        usefulLifeMonths: Number(values.usefulLifeMonths),
      };
      if (isNew) {
        const created = await api<Asset>("/assets", { method: "POST", body });
        router.replace(`/accounting/assets/${created.id}`);
      } else {
        await api(`/assets/${id}`, { method: "PATCH", body });
        setVersion((n) => n + 1);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      if (err instanceof ApiError) setFieldErrors(err.fieldErrors);
    }
  }

  async function confirmAsset() {
    setError(null);
    try {
      await api(`/assets/${id}/confirm`, { method: "POST" });
      setVersion((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const accountSelect = (
    k: "assetAccountId" | "depreciationAccountId" | "expenseAccountId",
    label: string,
  ) => (
    <label className="field">
      <span>{label}</span>
      <select required value={values[k]} onChange={(e) => set(k, e.target.value)}>
        <option value="">—</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.code} {a.name}
          </option>
        ))}
      </select>
      {fieldErrors[k] && <small className="error">{fieldErrors[k]}</small>}
    </label>
  );

  if (!isNew && !asset) return <p className="muted">{error ?? l("Memuat…", "Loading…")}</p>;

  return (
    <div className="stack-wide">
      <form className="panel" onSubmit={save}>
        <header className="toolbar">
          <h1>{isNew ? l("Aset baru", "New asset") : values.name}</h1>
          {editable && <button className="primary">{l("Simpan", "Save")}</button>}
          {asset?.state === "draft" && can(me.permissions, "accounting.post") && (
            <button type="button" className="primary" onClick={confirmAsset}>
              {l("Konfirmasi & buat jadwal", "Confirm & build schedule")}
            </button>
          )}
        </header>
        {error && <p className="error">{error}</p>}
        <fieldset disabled={!editable} className="fields">
          <label className="field">
            <span>{l("Kode", "Code")}</span>
            <input value={values.code} onChange={(e) => set("code", e.target.value)} />
          </label>
          <label className="field">
            <span>{l("Nama *", "Name *")}</span>
            <input required value={values.name} onChange={(e) => set("name", e.target.value)} />
          </label>
          <label className="field">
            <span>{l("Kelompok fiskal (isi masa manfaat)", "Tax group (fills useful life)")}</span>
            <select
              value=""
              onChange={(e) => {
                const g = TAX_ASSET_GROUPS.find((x) => x.key === e.target.value);
                if (g) set("usefulLifeMonths", String(g.years * 12));
              }}
            >
              <option value="">—</option>
              {TAX_ASSET_GROUPS.map((g) => (
                <option key={g.key} value={g.key}>
                  {GROUP_LABEL[g.key]![locale === "id" ? 0 : 1]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{l("Masa manfaat (bulan) *", "Useful life (months) *")}</span>
            <input
              type="number"
              min={1}
              required
              value={values.usefulLifeMonths}
              onChange={(e) => set("usefulLifeMonths", e.target.value)}
            />
          </label>
          <label className="field">
            <span>{l("Metode", "Method")}</span>
            <select value={values.method} onChange={(e) => set("method", e.target.value)}>
              <option value="straight_line">{l("Garis lurus", "Straight line")}</option>
              <option value="declining_balance">{l("Saldo menurun", "Declining balance")}</option>
            </select>
          </label>
          <label className="field">
            <span>{l("Harga perolehan *", "Cost *")}</span>
            <input
              className="num"
              inputMode="decimal"
              required
              value={values.cost}
              onChange={(e) => set("cost", e.target.value)}
            />
            {fieldErrors.cost && <small className="error">{fieldErrors.cost}</small>}
          </label>
          <label className="field">
            <span>{l("Nilai sisa", "Salvage value")}</span>
            <input
              className="num"
              inputMode="decimal"
              value={values.salvageValue}
              onChange={(e) => set("salvageValue", e.target.value)}
            />
          </label>
          <label className="field">
            <span>{l("Tanggal perolehan *", "Acquisition date *")}</span>
            <input
              type="date"
              required
              value={values.acquisitionDate}
              onChange={(e) => set("acquisitionDate", e.target.value)}
            />
          </label>
          <label className="field">
            <span>{l("Mulai penyusutan *", "Depreciation start *")}</span>
            <input
              type="date"
              required
              value={values.firstDepreciationDate}
              onChange={(e) => set("firstDepreciationDate", e.target.value)}
            />
          </label>
          {accountSelect("assetAccountId", l("Akun aset *", "Asset account *"))}
          {accountSelect(
            "depreciationAccountId",
            l("Akun akumulasi penyusutan *", "Accumulated depreciation *"),
          )}
          {accountSelect("expenseAccountId", l("Akun beban penyusutan *", "Depreciation expense *"))}
        </fieldset>
        <p className="muted">
          {l(
            "Catat pembelian aset lewat tagihan pembelian ke akun aset; modul ini menghitung dan memposting penyusutannya.",
            "Record the purchase through a vendor bill to the asset account; this module computes and posts depreciation.",
          )}
        </p>
      </form>

      {asset?.schedule && asset.schedule.length > 0 && (
        <section className="panel">
          <h2>{l("Jadwal penyusutan", "Depreciation schedule")}</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>{l("Tanggal", "Date")}</th>
                  <th className="num">{l("Penyusutan", "Depreciation")}</th>
                  <th className="num">{l("Akumulasi", "Accumulated")}</th>
                  <th className="num">{l("Nilai buku", "Book value")}</th>
                  <th>{l("Entri", "Entry")}</th>
                </tr>
              </thead>
              <tbody>
                {asset.schedule.map((s) => (
                  <tr key={s.id}>
                    <td>{s.sequence}</td>
                    <td>{formatDate(s.date, locale)}</td>
                    <td className="num">{money(s.amount, locale)}</td>
                    <td className="num">{money(s.accumulated, locale)}</td>
                    <td className="num">{money(s.bookValue, locale)}</td>
                    <td>
                      {s.moveId ? (
                        <Link href={`/accounting/moves/${s.moveId}`}>{s.moveName}</Link>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
