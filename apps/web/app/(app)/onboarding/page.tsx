"use client";

import { parseCsv } from "@erp/shared";
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../../../lib/api";
import { readFile } from "../../../lib/download";
import { money, today } from "../../../lib/format";
import { useI18n } from "../../../lib/i18n";

interface Company {
  name: string;
  npwp: string | null;
  nitku: string | null;
  pkp: boolean;
  street: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  phone: string | null;
  email: string | null;
}

interface Status {
  company: Company;
  steps: { key: string; label: string; status: "todo" | "done" | "skipped" }[];
  remaining: number;
  completedAt: string | null;
}

type Line = { accountCode: string; debit: string; credit: string; name?: string };

const LINKS: Record<string, string> = {
  partners: "/partners",
  products: "/products",
  users: "/settings/users",
  plan: "/settings/billing",
};

/** CSV saldo awal: kolom kode akun, debit, kredit (judul kolom Indonesia atau Inggris). */
function parseOpening(text: string): Line[] {
  return parseCsv(text).map((row) => {
    const get = (...keys: string[]) => {
      const key = Object.keys(row).find((k) => keys.includes(k.toLowerCase().replace(/[^a-z]/g, "")));
      return key ? (row[key] ?? "").trim() : "";
    };
    // "1.234.567,89" (format Indonesia) atau "1234567.89".
    const num = (v: string) =>
      (v.includes(",") || /\.\d{3}(\.|$)/.test(v) ? v.replace(/\./g, "").replace(",", ".") : v) || "0";
    return {
      accountCode: get("kodeakun", "akun", "accountcode", "account", "kode"),
      debit: num(get("debit", "debet")),
      credit: num(get("kredit", "credit")),
      name: get("keterangan", "description", "name") || undefined,
    };
  });
}

export default function OnboardingPage() {
  const { l, locale } = useI18n();
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [openingDate, setOpeningDate] = useState(`${today().slice(0, 4)}-01-01`);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Status>("/onboarding")
      .then(setStatus)
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function run(action: () => Promise<unknown>, done?: string) {
    setError(null);
    setMessage(null);
    try {
      const res = await action();
      if (res && typeof res === "object" && "steps" in res) setStatus(res as Status);
      else load();
      if (done) setMessage(done);
      setOpen(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function saveCompany(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const value = (k: string) => String(form.get(k) ?? "").trim() || null;
    void run(() =>
      api("/onboarding/company", {
        method: "PUT",
        body: {
          name: value("name"),
          npwp: value("npwp"),
          nitku: value("nitku"),
          pkp: form.get("pkp") === "on",
          street: value("street"),
          city: value("city"),
          province: value("province"),
          postalCode: value("postalCode"),
          phone: value("phone"),
          email: value("email"),
        },
      }),
    );
  }

  if (!status) return error ? <p className="error">{error}</p> : <p className="muted">…</p>;
  const c = status.company;
  const debit = lines.reduce((s, x) => s + Number(x.debit), 0);
  const credit = lines.reduce((s, x) => s + Number(x.credit), 0);

  return (
    <>
      <header className="toolbar">
        <h1>{l("Panduan Awal", "Getting Started")}</h1>
        <span className="muted">
          {status.remaining
            ? l(`${status.remaining} langkah lagi`, `${status.remaining} steps left`)
            : l("Semua langkah selesai", "All steps done")}
        </span>
      </header>
      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}
      <ol className="steps">
        {status.steps.map((s) => (
          <li key={s.key}>
            <span
              className={`badge ${s.status === "done" ? "state-posted" : s.status === "skipped" ? "state-cancel" : "state-draft"}`}
            >
              {s.status === "done"
                ? "✓"
                : s.status === "skipped"
                  ? l("dilewati", "skipped")
                  : l("belum", "todo")}
            </span>
            <span className="grow">{s.label}</span>
            {(s.key === "company" || s.key === "tax") && (
              <button onClick={() => setOpen(open === "company" ? null : "company")}>
                {l("Isi", "Fill in")}
              </button>
            )}
            {s.key === "opening" && s.status !== "done" && (
              <button onClick={() => setOpen(open === "opening" ? null : "opening")}>
                {l("Masukkan", "Enter")}
              </button>
            )}
            {LINKS[s.key] && (
              <Link className="button" href={LINKS[s.key]!}>
                {l("Buka", "Open")}
              </Link>
            )}
            {s.status === "todo" && s.key !== "company" && (
              <button
                className="link"
                onClick={() =>
                  run(() =>
                    api("/onboarding/steps", { method: "POST", body: { step: s.key, status: "skipped" } }),
                  )
                }
              >
                {l("Lewati", "Skip")}
              </button>
            )}
          </li>
        ))}
      </ol>

      {open === "company" && (
        <form className="panel" onSubmit={saveCompany}>
          <h2>{l("Profil perusahaan", "Company profile")}</h2>
          <label className="field">
            <span>{l("Nama perusahaan", "Company name")}</span>
            <input name="name" required defaultValue={c.name} />
          </label>
          <label className="field">
            <span>NPWP (16 digit)</span>
            <input name="npwp" defaultValue={c.npwp ?? ""} inputMode="numeric" />
          </label>
          <label className="field">
            <span>{l("ID TKU (kosongkan = NPWP + 000000)", "Branch tax ID (empty = NPWP + 000000)")}</span>
            <input name="nitku" defaultValue={c.nitku ?? ""} inputMode="numeric" />
          </label>
          <label className="check">
            <input type="checkbox" name="pkp" defaultChecked={c.pkp} />{" "}
            {l(
              "Pengusaha Kena Pajak (memungut PPN & membuat faktur pajak)",
              "VAT-registered (collects VAT & issues tax invoices)",
            )}
          </label>
          <label className="field">
            <span>{l("Alamat", "Street")}</span>
            <input name="street" defaultValue={c.street ?? ""} />
          </label>
          <label className="field">
            <span>{l("Kota", "City")}</span>
            <input name="city" defaultValue={c.city ?? ""} />
          </label>
          <label className="field">
            <span>{l("Provinsi", "Province")}</span>
            <input name="province" defaultValue={c.province ?? ""} />
          </label>
          <label className="field">
            <span>{l("Kode pos", "Postal code")}</span>
            <input name="postalCode" defaultValue={c.postalCode ?? ""} />
          </label>
          <label className="field">
            <span>{l("Telepon", "Phone")}</span>
            <input name="phone" defaultValue={c.phone ?? ""} />
          </label>
          <label className="field">
            <span>Email</span>
            <input name="email" type="email" defaultValue={c.email ?? ""} />
          </label>
          <div className="form-actions">
            <button className="primary">{l("Simpan", "Save")}</button>
          </div>
        </form>
      )}

      {open === "opening" && (
        <div className="panel">
          <h2>{l("Saldo awal", "Opening balances")}</h2>
          <p className="muted">
            {l(
              "Unggah CSV dengan kolom: kode akun, debit, kredit (opsional keterangan). Selisih debit/kredit otomatis dibukukan ke akun 3-9900 Ekuitas Saldo Awal.",
              "Upload a CSV with columns: account code, debit, credit (optional description). Any difference goes to 3-9900 Opening Balance Equity.",
            )}
          </p>
          <label className="field">
            <span>{l("Tanggal saldo awal", "Opening date")}</span>
            <input type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />
          </label>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) setLines(parseOpening(await readFile(file)).filter((x) => x.accountCode));
            }}
          />
          {lines.length > 0 && (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{l("Akun", "Account")}</th>
                      <th className="num">Debit</th>
                      <th className="num">{l("Kredit", "Credit")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((x, i) => (
                      <tr key={i}>
                        <td>
                          {x.accountCode} {x.name && <span className="muted">{x.name}</span>}
                        </td>
                        <td className="num">{money(x.debit, locale)}</td>
                        <td className="num">{money(x.credit, locale)}</td>
                      </tr>
                    ))}
                    <tr>
                      <th>{l("Total", "Total")}</th>
                      <th className="num">{money(debit, locale)}</th>
                      <th className="num">{money(credit, locale)}</th>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="form-actions">
                <button
                  className="primary"
                  onClick={() =>
                    run(
                      () =>
                        api("/onboarding/opening-balance", {
                          method: "POST",
                          body: { date: openingDate, lines },
                        }),
                      l("Saldo awal diposting.", "Opening balances posted."),
                    )
                  }
                >
                  {l("Posting saldo awal", "Post opening balances")}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {!status.completedAt && (
        <div className="form-actions">
          <button onClick={() => run(() => api("/onboarding/complete", { method: "POST" }))}>
            {l("Tandai panduan selesai", "Mark guide as complete")}
          </button>
        </div>
      )}
    </>
  );
}
