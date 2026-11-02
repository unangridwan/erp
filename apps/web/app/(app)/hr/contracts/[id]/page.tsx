"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useOptions } from "../../../../../components/accounting/use-options";
import { RefSelect } from "../../../../../components/ref-select";
import { api, ApiError } from "../../../../../lib/api";
import { money, today } from "../../../../../lib/format";
import { useI18n } from "../../../../../lib/i18n";
import { CONTRACT_STATE_LABEL } from "../../../../../lib/resources";

interface Contract {
  id: string;
  name: string;
  employeeId: string;
  employeeName: string;
  contractType: "pkwt" | "pkwtt";
  dateStart: string;
  dateEnd: string | null;
  wage: string;
  wageType: "monthly" | "daily" | "piece";
  taxMethod: "gross" | "gross_up";
  state: string;
  note: string | null;
  allowances: { componentId: string; amount: string; name: string; kind: string; fixed: boolean }[];
  grade: {
    code: string;
    name: string;
    minWage: string;
    maxWage: string;
    position: "below" | "within" | "above" | null;
  } | null;
}
interface Component {
  id: string;
  code: string;
  name: string;
  kind: string;
  fixed: boolean;
}

/** Kontrak kerja: PKWT/PKWTT, gaji pokok, tunjangan & potongan bulanan. */
export default function ContractPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { l, tx, locale } = useI18n();
  const isNew = id === "new";
  const components = useOptions<Component>("/salary-components");
  const [contract, setContract] = useState<Contract | null>(null);
  const [form, setForm] = useState({
    employeeId: "",
    contractType: "pkwtt",
    dateStart: today(),
    dateEnd: "",
    wage: "",
    wageType: "monthly",
    taxMethod: "gross",
    note: "",
  });
  const [allowances, setAllowances] = useState<{ componentId: string; amount: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (isNew) return;
    api<Contract>(`/contracts/${id}`)
      .then((c) => {
        setContract(c);
        setForm({
          employeeId: c.employeeId,
          contractType: c.contractType,
          dateStart: c.dateStart,
          dateEnd: c.dateEnd ?? "",
          wage: String(Number(c.wage)),
          wageType: c.wageType,
          taxMethod: c.taxMethod,
          note: c.note ?? "",
        });
        setAllowances(
          c.allowances.map((a) => ({ componentId: a.componentId, amount: String(Number(a.amount)) })),
        );
      })
      .catch((e: Error) => setError(e.message));
  }, [id, isNew, version]);

  const editable = isNew || contract?.state === "draft" || contract?.state === "running";
  async function run(fn: () => Promise<void>) {
    setError(null);
    setFieldErrors({});
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (e instanceof ApiError) setFieldErrors(e.fieldErrors);
    }
  }
  const save = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const body = {
        ...form,
        dateEnd: form.dateEnd || null,
        note: form.note || null,
        allowances: allowances.filter((a) => a.componentId),
      };
      if (isNew) {
        const c = await api<Contract>("/contracts", { method: "POST", body });
        router.replace(`/hr/contracts/${c.id}`);
      } else {
        await api(`/contracts/${id}`, { method: "PUT", body });
        setVersion((v) => v + 1);
      }
    });
  };
  const [started, setStarted] = useState(false);
  const action = (path: string) =>
    run(async () => {
      await api(`/contracts/${id}/${path}`, { method: "POST", body: {} });
      if (path === "start") setStarted(true);
      setVersion((v) => v + 1);
    });
  const err = (p: string) => fieldErrors[p] && <small className="error">{fieldErrors[p]}</small>;
  if (!isNew && !contract) return <p className="muted">{error ?? l("Memuat…", "Loading…")}</p>;
  const fixedTotal = allowances.reduce(
    (s, a) => s + (components.find((c) => c.id === a.componentId)?.fixed ? Number(a.amount || 0) : 0),
    Number(form.wage || 0),
  );

  return (
    <form className="panel" onSubmit={save}>
      <header className="toolbar">
        <h1>
          {contract ? `${contract.name} — ${contract.employeeName}` : l("Kontrak baru", "New contract")}
        </h1>
        {contract && (
          <span className={`badge state-${contract.state === "running" ? "sale" : contract.state}`}>
            {tx(CONTRACT_STATE_LABEL[contract.state]!)}
          </span>
        )}
        {editable && <button className="primary">{l("Simpan", "Save")}</button>}
        {contract?.state === "draft" && (
          <button type="button" className="primary" onClick={() => action("start")}>
            {l("Mulai berlaku", "Start")}
          </button>
        )}
        {contract?.state === "running" && (
          <button
            type="button"
            className="danger"
            onClick={() => confirm(l("Akhiri kontrak ini?", "End this contract?")) && action("close")}
          >
            {l("Akhiri", "End")}
          </button>
        )}
      </header>
      {error && <p className="error">{error}</p>}
      {started && contract && (
        <p className="success">
          {l(
            "Kontrak dimulai. Calon karyawan dari rekrutmen kini aktif (masuk payroll) dan onboarding dimulai.",
            "Contract started. A pre-hire from recruitment is now active (included in payroll) and onboarding has started.",
          )}{" "}
          <Link href={`/employees/${contract.employeeId}`}>{l("Buka karyawan", "Open employee")}</Link>
          {" · "}
          <Link href="/hr/checklists">{l("Checklist onboarding", "Onboarding checklists")}</Link>
        </p>
      )}
      {contract?.grade?.position && contract.grade.position !== "within" && (
        <p className="error">
          {l(
            `Gaji pokok ${contract.grade.position === "below" ? "di bawah" : "di atas"} skala upah golongan ${contract.grade.code} (${money(contract.grade.minWage, locale)} – ${money(contract.grade.maxWage, locale)}).`,
            `Base wage is ${contract.grade.position} the ${contract.grade.code} grade range (${money(contract.grade.minWage, locale)} – ${money(contract.grade.maxWage, locale)}).`,
          )}
        </p>
      )}
      <fieldset className="fields" disabled={!editable}>
        <label className="field">
          <span>{l("Karyawan *", "Employee *")}</span>
          <RefSelect
            name="employeeId"
            resource="employees"
            display="name"
            required
            disabled={!isNew}
            value={form.employeeId}
            onChange={(v) => setForm((f) => ({ ...f, employeeId: v }))}
          />
          {err("employeeId")}
        </label>
        <label className="field">
          <span>{l("Jenis kontrak", "Contract type")}</span>
          <select
            value={form.contractType}
            onChange={(e) => setForm((f) => ({ ...f, contractType: e.target.value }))}
          >
            <option value="pkwtt">{l("PKWTT (karyawan tetap)", "PKWTT (permanent)")}</option>
            <option value="pkwt">{l("PKWT (kontrak waktu tertentu)", "PKWT (fixed-term)")}</option>
          </select>
        </label>
        <label className="field">
          <span>{l("Mulai *", "Start *")}</span>
          <input
            type="date"
            required
            value={form.dateStart}
            onChange={(e) => setForm((f) => ({ ...f, dateStart: e.target.value }))}
          />
        </label>
        <label className="field">
          <span>{l("Berakhir", "End")}</span>
          <input
            type="date"
            value={form.dateEnd}
            onChange={(e) => setForm((f) => ({ ...f, dateEnd: e.target.value }))}
          />
          {err("dateEnd")}
        </label>
        <label className="field">
          <span>{l("Jenis upah", "Wage type")}</span>
          <select
            value={form.wageType}
            onChange={(e) => setForm((f) => ({ ...f, wageType: e.target.value }))}
          >
            <option value="monthly">{l("Bulanan", "Monthly")}</option>
            <option value="daily">{l("Harian lepas (per hari hadir)", "Daily (per day present)")}</option>
            <option value="piece">
              {l("Borongan (per satuan hasil kerja)", "Piece rate (per unit of output)")}
            </option>
          </select>
        </label>
        <label className="field">
          <span>{l("Metode PPh 21", "PPh 21 method")}</span>
          <select
            value={form.taxMethod}
            onChange={(e) => setForm((f) => ({ ...f, taxMethod: e.target.value }))}
          >
            <option value="gross">{l("Gross — dipotong dari gaji", "Gross — withheld from pay")}</option>
            <option value="gross_up">
              {l("Gross-up — ditanggung perusahaan (tunjangan PPh 21)", "Gross-up — borne by the company")}
            </option>
          </select>
        </label>
        <label className="field">
          <span>
            {form.wageType === "daily"
              ? l("Upah per hari *", "Wage per day *")
              : form.wageType === "piece"
                ? l("Upah per satuan *", "Rate per unit *")
                : l("Gaji pokok / bulan *", "Base wage / month *")}
          </span>
          <input
            className="num"
            inputMode="decimal"
            required
            value={form.wage}
            onChange={(e) => setForm((f) => ({ ...f, wage: e.target.value }))}
          />
          {err("wage")}
        </label>
        <label className="field">
          <span>{l("Catatan", "Note")}</span>
          <input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
        </label>
      </fieldset>

      <h2>{l("Tunjangan & potongan bulanan", "Monthly allowances & deductions")}</h2>
      <div className="table-scroll">
        <table className="lines">
          <thead>
            <tr>
              <th>{l("Komponen", "Component")}</th>
              <th>{l("Jenis", "Kind")}</th>
              <th className="num">{l("Jumlah / bulan", "Amount / month")}</th>
              {editable && <th />}
            </tr>
          </thead>
          <tbody>
            {allowances.map((a, i) => {
              const c = components.find((x) => x.id === a.componentId);
              return (
                <tr key={i}>
                  <td>
                    <select
                      disabled={!editable}
                      value={a.componentId}
                      onChange={(e) =>
                        setAllowances((rs) =>
                          rs.map((r, j) => (j === i ? { ...r, componentId: e.target.value } : r)),
                        )
                      }
                    >
                      <option value="">—</option>
                      {components.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.code} — {x.name}
                        </option>
                      ))}
                    </select>
                    {err(`allowances.${i}.componentId`)}
                  </td>
                  <td>
                    {c
                      ? c.kind === "deduction"
                        ? l("Potongan", "Deduction")
                        : c.fixed
                          ? l("Tunjangan tetap", "Fixed allowance")
                          : l("Tunjangan tidak tetap", "Variable allowance")
                      : ""}
                  </td>
                  <td>
                    <input
                      disabled={!editable}
                      className="num"
                      inputMode="decimal"
                      value={a.amount}
                      onChange={(e) =>
                        setAllowances((rs) =>
                          rs.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)),
                        )
                      }
                    />
                  </td>
                  {editable && (
                    <td>
                      <button
                        type="button"
                        className="link"
                        onClick={() => setAllowances((rs) => rs.filter((_, j) => j !== i))}
                      >
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          {editable && (
            <tfoot>
              <tr>
                <td colSpan={4}>
                  <button
                    type="button"
                    className="link"
                    onClick={() => setAllowances((rs) => [...rs, { componentId: "", amount: "0" }])}
                  >
                    + {l("Tambah komponen", "Add component")}
                  </button>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {form.wageType === "monthly" ? (
        <p className="muted">
          {l(
            "Upah dasar BPJS & lembur (gaji pokok + tunjangan tetap)",
            "BPJS & overtime wage base (base + fixed allowances)",
          )}
          : {money(fixedTotal, locale)}
        </p>
      ) : (
        <p className="muted">
          {form.wageType === "daily"
            ? l(
                "Upah dihitung dari jumlah hari hadir di absensi × upah per hari.",
                "Pay = days present in attendance × daily wage.",
              )
            : l(
                "Upah dihitung dari hasil kerja (menu Hasil Kerja Borongan) × upah per satuan.",
                "Pay = recorded work entries (Piece Work menu) × rate per unit.",
              )}{" "}
          {l(
            "Sebelum masa kerja mencapai batas di pengaturan payroll, BPJS yang dibayar hanya JKK & JKM.",
            "Until the tenure threshold in payroll settings, only JKK & JKM are contributed.",
          )}
        </p>
      )}
    </form>
  );
}
