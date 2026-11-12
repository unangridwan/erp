"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useOptions, type AccountOption } from "../../../../components/accounting/use-options";
import { ask, toast } from "../../../../components/feedback";
import { useMe } from "../../../../components/me-context";
import { api, ApiError } from "../../../../lib/api";
import { money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

type Tab = "run" | "cycles" | "keys";
interface Center {
  id: string;
  code: string;
  name: string;
}
interface Key {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  kind: "manual" | "headcount";
}
interface Receiver {
  costCenterId: string;
  percent: string | null;
}
interface Cycle {
  id: string;
  code: string;
  name: string;
  sequence: number;
  sourceCostCenterId: string;
  accountIds: string[];
  method: "percent" | "key";
  keyId: string | null;
  active: boolean;
  note: string | null;
  receivers: Receiver[];
}
interface Plan {
  cycleId: string;
  code: string;
  name: string;
  amount: string;
  status: "ready" | "done" | "empty" | "error";
  message?: string;
  accounts: { accountId: string; code: string; name: string; amount: string }[];
  receivers: { costCenterId: string; code: string; name: string; basis: string; amount: string }[];
}
interface Run {
  id: string;
  code: string;
  name: string;
  period: string;
  state: "posted" | "reversed";
  amount: string;
  moveId: string | null;
  moveName: string | null;
  reversalMoveId: string | null;
}

const thisMonth = () => new Date().toISOString().slice(0, 7);
const emptyCycle = (): Omit<Cycle, "id"> => ({
  code: "",
  name: "",
  sequence: 10,
  sourceCostCenterId: "",
  accountIds: [],
  method: "percent",
  keyId: null,
  active: true,
  note: null,
  receivers: [{ costCenterId: "", percent: "" }],
});

/** Alokasi biaya periodik antar cost center: jalankan per bulan, siklus, dan kunci statistik. */
export default function AllocationPage() {
  const me = useMe();
  const { l } = useI18n();
  const manage = can(me.permissions, "accounting.manage");
  const post = can(me.permissions, "accounting.post");
  const centers = useOptions<Center>("/cost-centers");
  const accounts = useOptions<AccountOption>("/accounts").filter((a) => a.accountType.startsWith("expense"));
  const [tab, setTab] = useState<Tab>("run");
  const [keys, setKeys] = useState<Key[]>([]);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const center = (id: string | null) => {
    const c = centers.find((x) => x.id === id);
    return c ? `${c.code} ${c.name}` : "—";
  };

  const loadCycles = useCallback(() => api<Cycle[]>("/allocation-cycles").then(setCycles), []);
  const loadKeys = useCallback(
    () => api<{ items: Key[] }>("/statistical-keys?limit=200").then((r) => setKeys(r.items)),
    [],
  );
  useEffect(() => {
    loadCycles().catch((e: Error) => toast.error(e.message));
    loadKeys().catch(() => setKeys([]));
  }, [loadCycles, loadKeys]);

  return (
    <>
      <header className="toolbar">
        <h1>{l("Alokasi biaya", "Cost allocation")}</h1>
      </header>
      <p className="muted">
        {l(
          "Biaya cost center pendukung (mis. IT, umum) dibagi ke cost center lain tiap bulan dengan persen tetap atau kunci statistik. Hasilnya jurnal alokasi bertanggal akhir bulan per akun asal; siklus dijalankan berurutan sehingga biaya yang diterima ikut dibagi pada siklus berikutnya. ",
          "Costs of support cost centers (e.g. IT, general) are split to other cost centers each month by fixed percentages or statistical keys. The result is a month-end allocation entry per original account; cycles run in sequence so costs received are passed on by later cycles. ",
        )}
        <Link href="/accounting/controlling">{l("Laporan controlling", "Controlling report")}</Link>
      </p>
      <nav className="tabs">
        {(
          [
            ["run", l("Jalankan", "Run")],
            ["cycles", l("Siklus alokasi", "Allocation cycles")],
            ["keys", l("Kunci statistik", "Statistical keys")],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </nav>
      {tab === "run" && <RunTab post={post} cyclesCount={cycles.length} />}
      {tab === "cycles" && (
        <CyclesTab
          cycles={cycles}
          keys={keys}
          centers={centers}
          accounts={accounts}
          manage={manage}
          center={center}
          reload={loadCycles}
        />
      )}
      {tab === "keys" && <KeysTab keys={keys} manage={manage} reload={loadKeys} />}
    </>
  );
}

function RunTab({ post, cyclesCount }: { post: boolean; cyclesCount: number }) {
  const { l, locale } = useI18n();
  const m = (v: string | number) => money(v, locale);
  const [period, setPeriod] = useState(thisMonth());
  const [preview, setPreview] = useState<Plan[] | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api<{ cycles: Plan[] }>("/allocation-runs/preview", { method: "POST", body: { period } })
      .then((r) => setPreview(r.cycles))
      .catch((e: Error) => toast.error(e.message));
    api<Run[]>(`/allocation-runs?period=${period}`)
      .then(setRuns)
      .catch(() => setRuns([]));
  }, [period]);
  useEffect(load, [load]);

  const run = async () => {
    if (!(await ask(l(`Jalankan alokasi bulan ${period}?`, `Run allocation for ${period}?`)))) return;
    setBusy(true);
    try {
      const r = await api<{ cycles: Plan[] }>("/allocation-runs", { method: "POST", body: { period } });
      const done = r.cycles.filter((c) => c.status === "done").length;
      toast.success(l(`${done} siklus terposting`, `${done} cycles posted`));
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const reverse = async (r: Run) => {
    if (
      !(await ask({
        message: l(
          `Balik alokasi ${r.code} bulan ${r.period.slice(0, 7)}? Jurnal pembalik dibuat dan siklus bisa dijalankan ulang.`,
          `Reverse allocation ${r.code} for ${r.period.slice(0, 7)}? A reversal entry is created and the cycle can be run again.`,
        ),
        danger: true,
      }))
    )
      return;
    try {
      await api(`/allocation-runs/${r.id}/reverse`, { method: "POST" });
      toast.success(l("Alokasi dibalik", "Allocation reversed"));
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const statusLabel = (p: Plan) =>
    ({
      ready: l("Siap", "Ready"),
      done: l("Sudah diposting", "Posted"),
      empty: l("Tidak ada biaya", "No costs"),
      error: l("Tidak bisa", "Cannot run"),
    })[p.status];
  const ready = preview?.some((p) => p.status === "ready");

  return (
    <section className="stack-wide">
      <div className="panel filters">
        <label className="field">
          <span>{l("Bulan", "Month")}</span>
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </label>
        {post && (
          <button className="primary" disabled={busy || !ready} aria-busy={busy} onClick={run}>
            {l("Jalankan & posting", "Run & post")}
          </button>
        )}
      </div>
      {cyclesCount === 0 && (
        <p className="muted">{l("Belum ada siklus alokasi aktif.", "No active allocation cycles yet.")}</p>
      )}
      {preview?.map((p) => (
        <div key={p.cycleId} className="panel">
          <header className="toolbar">
            <h2>
              {p.code} · {p.name}
            </h2>
            <span className={`pill ${p.status === "done" ? "ok" : p.status === "error" ? "danger" : ""}`}>
              {statusLabel(p)}
            </span>
          </header>
          {p.message && <p className="muted">{p.message}</p>}
          {p.status !== "done" && p.accounts.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{l("Penerima", "Receiver")}</th>
                    <th className="num">{l("Dasar", "Basis")}</th>
                    <th className="num">{l("Bagian", "Share")}</th>
                  </tr>
                </thead>
                <tbody>
                  {p.receivers.map((r) => (
                    <tr key={r.costCenterId}>
                      <td>
                        {r.code} {r.name}
                      </td>
                      <td className="num">{Number(r.basis).toLocaleString(locale)}</td>
                      <td className="num">{m(r.amount)}</td>
                    </tr>
                  ))}
                  <tr className="grand">
                    <td colSpan={2}>
                      {l("Biaya sumber", "Source cost")} (
                      {p.accounts.map((a) => `${a.code} ${m(a.amount)}`).join(", ")})
                    </td>
                    <td className="num">{m(p.amount)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {p.status === "done" && (
            <p className="muted">
              {l("Terposting", "Posted")}: {m(p.amount)}
            </p>
          )}
        </div>
      ))}
      {preview && preview.length > 1 && (
        <p className="muted">
          {l(
            "Pratinjau siklus lanjutan dihitung dari data terposting saat ini; biaya yang diterima dari siklus sebelumnya ikut terhitung setelah dijalankan.",
            "Later cycles are previewed from currently posted data; costs received from earlier cycles are included once those run.",
          )}
        </p>
      )}
      {runs.length > 0 && (
        <div className="panel">
          <h2>{l("Riwayat bulan ini", "This month's history")}</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{l("Siklus", "Cycle")}</th>
                  <th>{l("Entri", "Entry")}</th>
                  <th className="num">{l("Jumlah", "Amount")}</th>
                  <th>{l("Status", "Status")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.code} · {r.name}
                    </td>
                    <td>
                      {r.moveId ? <Link href={`/accounting/moves/${r.moveId}`}>{r.moveName}</Link> : "—"}
                    </td>
                    <td className="num">{m(r.amount)}</td>
                    <td>{r.state === "posted" ? l("Terposting", "Posted") : l("Dibalik", "Reversed")}</td>
                    <td>
                      {post && r.state === "posted" && (
                        <button type="button" className="link danger" onClick={() => void reverse(r)}>
                          {l("Balik", "Reverse")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function CyclesTab(props: {
  cycles: Cycle[];
  keys: Key[];
  centers: Center[];
  accounts: AccountOption[];
  manage: boolean;
  center: (id: string | null) => string;
  reload: () => Promise<void>;
}) {
  const { l, locale } = useI18n();
  const [edit, setEdit] = useState<(Omit<Cycle, "id"> & { id?: string }) | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!edit) return;
    setBusy(true);
    setErrors({});
    const body = {
      ...edit,
      keyId: edit.method === "key" ? edit.keyId : null,
      receivers: edit.receivers
        .filter((r) => r.costCenterId)
        .map((r) => ({
          costCenterId: r.costCenterId,
          percent: edit.method === "percent" ? r.percent : null,
        })),
    };
    try {
      await api(edit.id ? `/allocation-cycles/${edit.id}` : "/allocation-cycles", {
        method: edit.id ? "PUT" : "POST",
        body,
      });
      toast.success(l("Siklus disimpan", "Cycle saved"));
      setEdit(null);
      await props.reload();
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (c: Cycle) => {
    if (!(await ask({ message: l(`Hapus siklus ${c.code}?`, `Delete cycle ${c.code}?`), danger: true })))
      return;
    try {
      await api(`/allocation-cycles/${c.id}`, { method: "DELETE" });
      await props.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const total = edit?.receivers.reduce((s, r) => s + Number(r.percent || 0), 0) ?? 0;
  const err = (k: string) => errors[k] && <small className="error">{errors[k]}</small>;
  const setRecv = (i: number, patch: Partial<Receiver>) =>
    setEdit((e) => e && { ...e, receivers: e.receivers.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  return (
    <section className="stack-wide">
      {props.manage && !edit && (
        <div>
          <button className="primary" onClick={() => setEdit(emptyCycle())}>
            {l("Siklus baru", "New cycle")}
          </button>
        </div>
      )}
      {edit && (
        <div className="panel">
          <h2>{edit.id ? edit.code : l("Siklus baru", "New cycle")}</h2>
          <div className="fields">
            <label className="field">
              <span>{l("Kode *", "Code *")}</span>
              <input value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} />
              {err("code")}
            </label>
            <label className="field">
              <span>{l("Nama *", "Name *")}</span>
              <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
              {err("name")}
            </label>
            <label className="field">
              <span>{l("Urutan jalan", "Run order")}</span>
              <input
                type="number"
                min={1}
                value={edit.sequence}
                onChange={(e) => setEdit({ ...edit, sequence: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              <span>{l("Cost center sumber *", "Source cost center *")}</span>
              <select
                value={edit.sourceCostCenterId}
                onChange={(e) => setEdit({ ...edit, sourceCostCenterId: e.target.value })}
              >
                <option value="">—</option>
                {props.centers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} {c.name}
                  </option>
                ))}
              </select>
              {err("sourceCostCenterId")}
            </label>
            <label className="field">
              <span>{l("Metode", "Method")}</span>
              <select
                value={edit.method}
                onChange={(e) => setEdit({ ...edit, method: e.target.value as Cycle["method"] })}
              >
                <option value="percent">{l("Persen tetap", "Fixed percentage")}</option>
                <option value="key">{l("Kunci statistik", "Statistical key")}</option>
              </select>
            </label>
            {edit.method === "key" && (
              <label className="field">
                <span>{l("Kunci statistik *", "Statistical key *")}</span>
                <select
                  value={edit.keyId ?? ""}
                  onChange={(e) => setEdit({ ...edit, keyId: e.target.value || null })}
                >
                  <option value="">—</option>
                  {props.keys.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.code} {k.name}
                    </option>
                  ))}
                </select>
                {err("keyId")}
              </label>
            )}
            <label className="field">
              <span>
                {l("Hanya akun (kosong = semua akun beban)", "Only accounts (empty = all expense accounts)")}
              </span>
              <select
                multiple
                size={4}
                value={edit.accountIds}
                onChange={(e) =>
                  setEdit({ ...edit, accountIds: [...e.target.selectedOptions].map((o) => o.value) })
                }
              >
                {props.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={edit.active}
                onChange={(e) => setEdit({ ...edit, active: e.target.checked })}
              />
              {l("Aktif", "Active")}
            </label>
          </div>
          <h3>{l("Penerima", "Receivers")}</h3>
          {err("receivers")}
          <div className="table-wrap">
            <table className="lines">
              <thead>
                <tr>
                  <th>{l("Cost center", "Cost center")}</th>
                  {edit.method === "percent" && <th className="num">%</th>}
                  <th />
                </tr>
              </thead>
              <tbody>
                {edit.receivers.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <select
                        aria-label={l("Cost center penerima", "Receiver cost center")}
                        value={r.costCenterId}
                        onChange={(e) => setRecv(i, { costCenterId: e.target.value })}
                      >
                        <option value="">—</option>
                        {props.centers
                          .filter((c) => c.id !== edit.sourceCostCenterId)
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.code} {c.name}
                            </option>
                          ))}
                      </select>
                      {err(`receivers.${i}.costCenterId`)}
                    </td>
                    {edit.method === "percent" && (
                      <td>
                        <input
                          className="num short"
                          inputMode="decimal"
                          aria-label={l("Persen", "Percent")}
                          value={r.percent ?? ""}
                          onChange={(e) => setRecv(i, { percent: e.target.value })}
                        />
                        {err(`receivers.${i}.percent`)}
                      </td>
                    )}
                    <td>
                      <button
                        type="button"
                        className="link"
                        aria-label={l("Hapus baris", "Remove line")}
                        onClick={() =>
                          setEdit({ ...edit, receivers: edit.receivers.filter((_, j) => j !== i) })
                        }
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>
                    <button
                      type="button"
                      className="link"
                      onClick={() =>
                        setEdit({
                          ...edit,
                          receivers: [...edit.receivers, { costCenterId: "", percent: "" }],
                        })
                      }
                    >
                      + {l("Tambah penerima", "Add receiver")}
                    </button>
                  </td>
                  {edit.method === "percent" && (
                    <td className={`num ${total === 100 ? "" : "error"}`}>{total.toLocaleString(locale)}%</td>
                  )}
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="cp-right">
            <button type="button" onClick={() => setEdit(null)}>
              {l("Batal", "Cancel")}
            </button>{" "}
            <button type="button" className="primary" disabled={busy} aria-busy={busy} onClick={save}>
              {l("Simpan", "Save")}
            </button>
          </div>
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="num">#</th>
              <th>{l("Siklus", "Cycle")}</th>
              <th>{l("Sumber", "Source")}</th>
              <th>{l("Metode", "Method")}</th>
              <th>{l("Penerima", "Receivers")}</th>
              <th>{l("Status", "Status")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {props.cycles.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  {l("Belum ada siklus alokasi.", "No allocation cycles yet.")}
                </td>
              </tr>
            )}
            {props.cycles.map((c) => (
              <tr key={c.id}>
                <td className="num">{c.sequence}</td>
                <td>
                  {c.code} · {c.name}
                </td>
                <td>{props.center(c.sourceCostCenterId)}</td>
                <td>
                  {c.method === "percent"
                    ? l("Persen tetap", "Fixed %")
                    : (props.keys.find((k) => k.id === c.keyId)?.name ??
                      l("Kunci statistik", "Statistical key"))}
                </td>
                <td>
                  {c.receivers
                    .map(
                      (r) =>
                        `${props.center(r.costCenterId)}${c.method === "percent" ? ` ${Number(r.percent)}%` : ""}`,
                    )
                    .join(", ")}
                </td>
                <td>{c.active ? l("Aktif", "Active") : l("Nonaktif", "Inactive")}</td>
                <td>
                  {props.manage && (
                    <>
                      <button
                        type="button"
                        className="link"
                        onClick={() =>
                          setEdit({
                            ...c,
                            receivers: c.receivers.map((r) => ({
                              ...r,
                              percent: r.percent === null ? "" : String(Number(r.percent)),
                            })),
                          })
                        }
                      >
                        {l("Ubah", "Edit")}
                      </button>{" "}
                      <button type="button" className="link danger" onClick={() => void remove(c)}>
                        {l("Hapus", "Delete")}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function KeysTab({ keys, manage, reload }: { keys: Key[]; manage: boolean; reload: () => Promise<void> }) {
  const { l, locale } = useI18n();
  const [keyId, setKeyId] = useState("");
  const [period, setPeriod] = useState(thisMonth());
  const [rows, setRows] = useState<
    { costCenterId: string; code: string; name: string; value: string | null }[]
  >([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ code: "", name: "", unit: "", kind: "manual" });
  const key = keys.find((k) => k.id === keyId);
  useEffect(() => {
    if (!keyId && keys[0]) setKeyId(keys[0].id);
  }, [keys, keyId]);
  useEffect(() => {
    if (!keyId) return;
    api<{ rows: typeof rows }>(`/statistical-keys/${keyId}/values?period=${period}`)
      .then((r) => {
        setRows(r.rows);
        setDraft(
          Object.fromEntries(
            r.rows.map((x) => [x.costCenterId, x.value === null ? "" : String(Number(x.value))]),
          ),
        );
      })
      .catch((e: Error) => toast.error(e.message));
  }, [keyId, period]);
  const create = async () => {
    try {
      const k = await api<Key>("/statistical-keys", {
        method: "POST",
        body: { ...form, unit: form.unit || null },
      });
      setForm({ code: "", name: "", unit: "", kind: "manual" });
      await reload();
      setKeyId(k.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const save = async () => {
    try {
      await api(`/statistical-keys/${keyId}/values`, {
        method: "PUT",
        body: {
          period,
          values: Object.entries(draft)
            .filter(([, v]) => v !== "")
            .map(([costCenterId, value]) => ({ costCenterId, value })),
        },
      });
      toast.success(l("Nilai kunci disimpan", "Key values saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <section className="stack-wide">
      <div className="panel filters">
        <label className="field">
          <span>{l("Kunci", "Key")}</span>
          <select value={keyId} onChange={(e) => setKeyId(e.target.value)}>
            {keys.map((k) => (
              <option key={k.id} value={k.id}>
                {k.code} {k.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{l("Berlaku mulai bulan", "Effective from month")}</span>
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </label>
      </div>
      {key && (
        <div className="panel">
          <p className="muted">
            {key.kind === "headcount"
              ? l(
                  "Jumlah karyawan aktif per cost center (dari karyawan atau departemennya) dihitung otomatis per bulan.",
                  "Active employees per cost center (from the employee or their department) are counted automatically each month.",
                )
              : l(
                  "Nilai berlaku mulai bulan ini sampai diisi lagi pada bulan berikutnya. Kosong = memakai nilai bulan sebelumnya.",
                  "Values apply from this month until changed in a later month. Empty = keeps the previous month's value.",
                )}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{l("Cost center", "Cost center")}</th>
                  <th className="num">
                    {l("Nilai", "Value")} {key.unit ? `(${key.unit})` : ""}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.costCenterId}>
                    <td>
                      {r.code} {r.name}
                    </td>
                    <td className="num">
                      {key.kind === "manual" && manage ? (
                        <input
                          className="num short"
                          inputMode="decimal"
                          aria-label={`${r.code} ${r.name}`}
                          value={draft[r.costCenterId] ?? ""}
                          onChange={(e) => setDraft({ ...draft, [r.costCenterId]: e.target.value })}
                        />
                      ) : r.value === null ? (
                        "—"
                      ) : (
                        Number(r.value).toLocaleString(locale)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {key.kind === "manual" && manage && (
            <div className="cp-right">
              <button className="primary" onClick={save}>
                {l("Simpan nilai", "Save values")}
              </button>
            </div>
          )}
        </div>
      )}
      {manage && (
        <div className="panel">
          <h2>{l("Kunci baru", "New key")}</h2>
          <div className="fields">
            <label className="field">
              <span>{l("Kode", "Code")}</span>
              <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            </label>
            <label className="field">
              <span>{l("Nama", "Name")}</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="field">
              <span>{l("Satuan", "Unit")}</span>
              <input
                value={form.unit}
                placeholder="m², jam"
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
              />
            </label>
            <label className="field">
              <span>{l("Jenis", "Kind")}</span>
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                <option value="manual">{l("Diisi manual", "Manual values")}</option>
                <option value="headcount">{l("Jumlah karyawan (otomatis)", "Headcount (automatic)")}</option>
              </select>
            </label>
          </div>
          <div className="cp-right">
            <button className="primary" disabled={!form.code || !form.name} onClick={create}>
              {l("Tambah kunci", "Add key")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
