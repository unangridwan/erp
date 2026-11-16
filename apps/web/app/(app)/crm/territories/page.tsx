"use client";

import { useEffect, useState } from "react";
import { useOptions } from "../../../../components/accounting/use-options";
import { ask, toast } from "../../../../components/feedback";
import { useMe } from "../../../../components/me-context";
import { api, ApiError } from "../../../../lib/api";
import { money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

interface Territory {
  id: string;
  name: string;
  sequence: number;
  rules: { provinces?: string[]; cities?: string[]; industries?: string[] };
  managerId: string | null;
  memberIds: string[];
  active: boolean;
}
interface Report {
  year: number;
  rows: {
    territoryId: string | null;
    name: string | null;
    accounts: number;
    openCount: number;
    pipeline: string;
    wonCount: number;
    wonAmount: string;
  }[];
}
interface Form {
  id: string | null;
  name: string;
  sequence: string;
  provinces: string;
  cities: string;
  industries: string;
  managerId: string;
  memberIds: string[];
  active: boolean;
}

const split = (v: string) =>
  v
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
const empty: Form = {
  id: null,
  name: "",
  sequence: "10",
  provinces: "",
  cities: "",
  industries: "",
  managerId: "",
  memberIds: [],
  active: true,
};

/** Wilayah penjualan: aturan provinsi/kota/industri, anggota penerima lead, dan ringkasan per wilayah. */
export default function TerritoriesPage() {
  const me = useMe();
  const { l, locale } = useI18n();
  const editable = can(me.permissions, "crm.manage");
  const users = useOptions<{ id: string; name: string }>("/users/options");
  const [items, setItems] = useState<Territory[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    api<{ items: Territory[] }>("/crm/territories?limit=200")
      .then((d) => setItems(d.items))
      .catch((e: Error) => setError(e.message));
    api<Report>("/crm/territory-report")
      .then(setReport)
      .catch(() => setReport(null));
  }, [version]);

  const userName = (id: string | null) => users.find((u) => u.id === id)?.name ?? "";
  const stats = (id: string | null) => report?.rows.find((r) => r.territoryId === id);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setVersion((v) => v + 1);
    } catch (e) {
      setError(
        e instanceof ApiError && Object.keys(e.fieldErrors).length
          ? Object.values(e.fieldErrors).join("; ")
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(async () => {
      if (!form) return;
      const body = {
        name: form.name,
        sequence: Number(form.sequence) || 0,
        rules: {
          provinces: split(form.provinces),
          cities: split(form.cities),
          industries: split(form.industries),
        },
        managerId: form.managerId || null,
        memberIds: form.memberIds,
        active: form.active,
      };
      if (form.id) await api(`/crm/territories/${form.id}`, { method: "PATCH", body });
      else await api("/crm/territories", { method: "POST", body });
      toast.success(l("Wilayah tersimpan", "Territory saved"));
      setForm(null);
    });

  const assign = () =>
    run(async () => {
      const r = await api<{ accounts: number; leads: number; assigned: number }>("/crm/territory-assign", {
        method: "POST",
        body: {},
      });
      toast.success(
        l(
          `${r.accounts} akun dan ${r.leads} lead/peluang diberi wilayah; ${r.assigned} lead ditugaskan.`,
          `${r.accounts} accounts and ${r.leads} leads/opportunities got a territory; ${r.assigned} leads assigned.`,
        ),
      );
    });

  return (
    <>
      <header className="toolbar">
        <h1>{l("Wilayah Penjualan", "Sales Territories")}</h1>
        {editable && (
          <>
            <button className="primary" onClick={() => setForm(empty)}>
              {l("Baru", "New")}
            </button>
            <button disabled={busy || items.length === 0} onClick={assign}>
              {l("Terapkan aturan ke data yang ada", "Apply rules to existing records")}
            </button>
          </>
        )}
      </header>
      {error && <p className="error">{error}</p>}
      <p className="muted">
        {l(
          "Lead dan akun baru otomatis masuk wilayah pertama (urutan terkecil) yang aturannya cocok. Lead tanpa penanggung jawab dibagi bergiliran ke anggota wilayah saat aturan diterapkan.",
          "New leads and accounts automatically join the first territory (lowest sequence) whose rules match. Leads without an owner are distributed round-robin to territory members when rules are applied.",
        )}
      </p>

      {form && (
        <section className="panel">
          <h2>{form.id ? l("Ubah wilayah", "Edit territory") : l("Wilayah baru", "New territory")}</h2>
          <div className="fields">
            <label className="field">
              <span>{l("Nama *", "Name *")}</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="field">
              <span>{l("Urutan", "Sequence")}</span>
              <input
                className="num"
                inputMode="numeric"
                value={form.sequence}
                onChange={(e) => setForm({ ...form, sequence: e.target.value })}
              />
            </label>
            <label className="field">
              <span>{l("Manajer wilayah", "Territory manager")}</span>
              <select
                value={form.managerId}
                onChange={(e) => setForm({ ...form, managerId: e.target.value })}
              >
                <option value="">—</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{l("Provinsi (pisahkan dengan koma)", "Provinces (comma-separated)")}</span>
              <input
                value={form.provinces}
                placeholder="Jawa Barat, Banten"
                onChange={(e) => setForm({ ...form, provinces: e.target.value })}
              />
            </label>
            <label className="field">
              <span>{l("Kota/kabupaten", "Cities")}</span>
              <input value={form.cities} onChange={(e) => setForm({ ...form, cities: e.target.value })} />
            </label>
            <label className="field">
              <span>{l("Industri", "Industries")}</span>
              <input
                value={form.industries}
                onChange={(e) => setForm({ ...form, industries: e.target.value })}
              />
            </label>
            <fieldset className="field" style={{ gridColumn: "1 / -1" }}>
              <legend>{l("Anggota (penerima lead)", "Members (lead recipients)")}</legend>
              <div className="filters">
                {users.map((u) => (
                  <label key={u.id}>
                    <input
                      type="checkbox"
                      checked={form.memberIds.includes(u.id)}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          memberIds: e.target.checked
                            ? [...form.memberIds, u.id]
                            : form.memberIds.filter((x) => x !== u.id),
                        })
                      }
                    />{" "}
                    {u.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="field">
              <span>{l("Aktif", "Active")}</span>
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
            </label>
          </div>
          <div className="filters">
            <button className="primary" disabled={busy || !form.name.trim()} onClick={save}>
              {l("Simpan", "Save")}
            </button>
            <button className="link" onClick={() => setForm(null)}>
              {l("Batal", "Cancel")}
            </button>
          </div>
        </section>
      )}

      <section className="panel">
        {items.length === 0 ? (
          <p className="muted">{l("Belum ada wilayah.", "No territories yet.")}</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>{l("Wilayah", "Territory")}</th>
                  <th>{l("Aturan", "Rules")}</th>
                  <th>{l("Anggota", "Members")}</th>
                  <th className="num">{l("Akun", "Accounts")}</th>
                  <th className="num">{l("Peluang terbuka", "Open opportunities")}</th>
                  <th className="num">{l("Pipeline", "Pipeline")}</th>
                  <th className="num">
                    {l("Menang", "Won")} {report?.year ?? ""}
                  </th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((t) => {
                  const s = stats(t.id);
                  const rules = [
                    ...(t.rules.provinces ?? []),
                    ...(t.rules.cities ?? []),
                    ...(t.rules.industries ?? []),
                  ];
                  return (
                    <tr key={t.id}>
                      <td className="num">{t.sequence}</td>
                      <td>
                        {t.name}
                        {!t.active && <span className="badge state-cancel">{l("Nonaktif", "Inactive")}</span>}
                        {t.managerId && <small className="muted"> · {userName(t.managerId)}</small>}
                      </td>
                      <td>{rules.length ? rules.join(", ") : l("(manual saja)", "(manual only)")}</td>
                      <td>{t.memberIds.map(userName).filter(Boolean).join(", ") || "—"}</td>
                      <td className="num">{s?.accounts ?? 0}</td>
                      <td className="num">{s?.openCount ?? 0}</td>
                      <td className="num">{money(s?.pipeline ?? 0, locale, 0)}</td>
                      <td className="num">{money(s?.wonAmount ?? 0, locale, 0)}</td>
                      <td>
                        {editable && (
                          <>
                            <button
                              className="link"
                              onClick={() =>
                                setForm({
                                  id: t.id,
                                  name: t.name,
                                  sequence: String(t.sequence),
                                  provinces: (t.rules.provinces ?? []).join(", "),
                                  cities: (t.rules.cities ?? []).join(", "),
                                  industries: (t.rules.industries ?? []).join(", "),
                                  managerId: t.managerId ?? "",
                                  memberIds: t.memberIds,
                                  active: t.active,
                                })
                              }
                            >
                              {l("Ubah", "Edit")}
                            </button>{" "}
                            <button
                              className="link"
                              onClick={() =>
                                run(async () => {
                                  if (
                                    !(await ask(
                                      l(`Hapus wilayah "${t.name}"?`, `Delete territory "${t.name}"?`),
                                    ))
                                  )
                                    return;
                                  await api(`/crm/territories/${t.id}`, { method: "DELETE" });
                                })
                              }
                            >
                              {l("Hapus", "Delete")}
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {stats(null) && (stats(null)!.openCount > 0 || stats(null)!.accounts > 0) && (
                  <tr>
                    <td />
                    <td className="muted">{l("(tanpa wilayah)", "(no territory)")}</td>
                    <td />
                    <td />
                    <td className="num">{stats(null)!.accounts}</td>
                    <td className="num">{stats(null)!.openCount}</td>
                    <td className="num">{money(stats(null)!.pipeline, locale, 0)}</td>
                    <td className="num">{money(stats(null)!.wonAmount, locale, 0)}</td>
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
