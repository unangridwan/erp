"use client";

import { useEffect, useMemo, useState } from "react";
import { useOptions } from "../../../../components/accounting/use-options";
import { toast } from "../../../../components/feedback";
import { useMe } from "../../../../components/me-context";
import { api } from "../../../../lib/api";
import { money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

interface Quota {
  userId: string | null;
  teamId: string | null;
  month: string;
  amount: string;
}
interface Attainment {
  months: string[];
  rows: {
    userId: string | null;
    userName: string | null;
    months: { month: string; closed: string; quota: string | null; attainment: number | null }[];
    closed: string;
    quota: string | null;
    attainment: number | null;
  }[];
  total: { closed: string; quota: string | null; attainment: number | null };
}

const MONTHS_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Kuota bulanan per salesperson/tim (grid setahun) dan pencapaiannya. */
export default function QuotasPage() {
  const me = useMe();
  const { l, locale } = useI18n();
  const editable = can(me.permissions, "crm.manage");
  const [year, setYear] = useState(new Date().getFullYear());
  const [tab, setTab] = useState<"quota" | "attainment">("quota");
  const users = useOptions<{ id: string; name: string }>("/users/options");
  const teams = useOptions<{ id: string; name: string }>("/sales-teams");
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [attainment, setAttainment] = useState<Attainment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  const months = useMemo(
    () => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`),
    [year],
  );
  const key = (kind: "u" | "t", id: string, month: string) => `${kind}:${id}:${month}`;

  useEffect(() => {
    setError(null);
    api<{ quotas: Quota[] }>(`/crm/quotas?year=${year}`)
      .then((d) => {
        const map = Object.fromEntries(
          d.quotas.map((q) => [
            q.userId ? key("u", q.userId, q.month) : key("t", q.teamId!, q.month),
            String(Number(q.amount)),
          ]),
        );
        setValues(map);
        setSaved(map);
      })
      .catch((e: Error) => setError(e.message));
    api<Attainment>(`/crm/forecast/attainment?year=${year}`)
      .then(setAttainment)
      .catch(() => setAttainment(null));
  }, [year, version]);

  const changed = Object.keys({ ...values, ...saved }).filter((k) => (values[k] ?? "") !== (saved[k] ?? ""));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api("/crm/quotas", {
        method: "PUT",
        body: {
          quotas: changed.map((k) => {
            const [kind, id, month] = k.split(":");
            const amount = (values[k] ?? "").trim();
            return { [kind === "u" ? "userId" : "teamId"]: id, month, amount: amount === "" ? null : amount };
          }),
        },
      });
      toast.success(l("Kuota tersimpan", "Quotas saved"));
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const monthName = (i: number) => (locale === "id" ? MONTHS_ID : MONTHS_EN)[i];
  const rowTotal = (kind: "u" | "t", id: string) =>
    months.reduce((s, mo) => s + (Number(values[key(kind, id, mo)]) || 0), 0);
  const grid = (kind: "u" | "t", title: string, owners: { id: string; name: string }[]) => (
    <section className="panel">
      <h2>{title}</h2>
      {owners.length === 0 ? (
        <p className="muted">—</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{title}</th>
                {months.map((mo, i) => (
                  <th key={mo} className="num">
                    {monthName(i)}
                  </th>
                ))}
                <th className="num">{l("Setahun", "Year")}</th>
              </tr>
            </thead>
            <tbody>
              {owners.map((o) => (
                <tr key={o.id}>
                  <td>{o.name}</td>
                  {months.map((mo, i) => (
                    <td key={mo} className="num">
                      <input
                        className="num"
                        inputMode="decimal"
                        style={{ width: 110 }}
                        aria-label={`${o.name} ${monthName(i)}`}
                        disabled={!editable}
                        value={values[key(kind, o.id, mo)] ?? ""}
                        onChange={(e) => setValues((v) => ({ ...v, [key(kind, o.id, mo)]: e.target.value }))}
                      />
                    </td>
                  ))}
                  <td className="num">{money(rowTotal(kind, o.id), locale, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );

  return (
    <>
      <header className="toolbar">
        <h1>{l("Kuota & Pencapaian", "Quotas & Attainment")}</h1>
        <label className="field">
          <span>{l("Tahun", "Year")}</span>
          <input
            type="number"
            style={{ width: 100 }}
            value={year}
            onChange={(e) => setYear(Number(e.target.value) || year)}
          />
        </label>
        {editable && tab === "quota" && changed.length > 0 && (
          <button className="primary" disabled={busy} onClick={save}>
            {l("Simpan kuota", "Save quotas")} ({changed.length})
          </button>
        )}
      </header>
      <div role="tablist" className="tabs">
        <button
          role="tab"
          aria-selected={tab === "quota"}
          className={tab === "quota" ? "active" : ""}
          onClick={() => setTab("quota")}
        >
          {l("Kuota", "Quotas")}
        </button>
        <button
          role="tab"
          aria-selected={tab === "attainment"}
          className={tab === "attainment" ? "active" : ""}
          onClick={() => setTab("attainment")}
        >
          {l("Pencapaian", "Attainment")}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {tab === "quota" ? (
        <>
          {!editable && (
            <p className="muted">
              {l("Kuota hanya bisa diubah oleh pengelola CRM.", "Only CRM managers can change quotas.")}
            </p>
          )}
          {grid("u", l("Salesperson", "Salesperson"), editable ? users : [{ id: me.userId, name: me.name }])}
          {editable && grid("t", l("Tim penjualan", "Sales team"), teams)}
          {editable && (
            <p className="muted">
              {l(
                "Kuota tim boleh dikosongkan; forecast tim lalu memakai jumlah kuota anggotanya.",
                "Team quotas may be left empty; the team forecast then uses the sum of its members' quotas.",
              )}
            </p>
          )}
        </>
      ) : (
        attainment && (
          <section className="panel">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{l("Salesperson", "Salesperson")}</th>
                    {attainment.months.map((mo, i) => (
                      <th key={mo} className="num">
                        {monthName(i)}
                      </th>
                    ))}
                    <th className="num">{l("Menang", "Won")}</th>
                    <th className="num">{l("Kuota", "Quota")}</th>
                    <th className="num">%</th>
                  </tr>
                </thead>
                <tbody>
                  {attainment.rows.length === 0 && (
                    <tr>
                      <td colSpan={16} className="muted">
                        {l(
                          "Belum ada kuota atau peluang menang pada tahun ini.",
                          "No quotas or won deals this year.",
                        )}
                      </td>
                    </tr>
                  )}
                  {attainment.rows.map((r) => (
                    <tr key={r.userId ?? "none"}>
                      <td>{r.userName ?? l("(belum ditugaskan)", "(unassigned)")}</td>
                      {r.months.map((c) => (
                        <td
                          key={c.month}
                          className="num"
                          title={c.quota ? `${l("Kuota", "Quota")}: ${money(c.quota, locale, 0)}` : undefined}
                        >
                          {Number(c.closed) > 0 || c.quota ? money(c.closed, locale, 0) : ""}
                          {c.attainment !== null && <small className="muted"> {c.attainment}%</small>}
                        </td>
                      ))}
                      <td className="num">{money(r.closed, locale, 0)}</td>
                      <td className="num">{r.quota ? money(r.quota, locale, 0) : "—"}</td>
                      <td className="num">{r.attainment === null ? "—" : `${r.attainment}%`}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={13}>{l("Total", "Total")}</th>
                    <th className="num">{money(attainment.total.closed, locale, 0)}</th>
                    <th className="num">
                      {attainment.total.quota ? money(attainment.total.quota, locale, 0) : "—"}
                    </th>
                    <th className="num">
                      {attainment.total.attainment === null ? "—" : `${attainment.total.attainment}%`}
                    </th>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        )
      )}
    </>
  );
}
