"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { formatDate, money, today } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { can } from "../../lib/resources";
import { errorText } from "../hr/hr-panels";
import { useMe } from "../me-context";
import { RefSelect } from "../ref-select";
import { ask } from "../feedback";
import { DatasetDrillPanel, type DatasetDrillRequest } from "../drilldown-panel";

interface Overview {
  vehicle: {
    id: string;
    licensePlate: string;
    odometer: string;
    odometerUnit: "km" | "mi";
    driverEmployeeId: string | null;
  };
  model: { name: string; category: string; manufacturer: string } | null;
  drivers: { id: string; name: string; startDate: string; endDate: string | null }[];
  odometers: { id: string; date: string; value: string; note: string | null; driver: string | null }[];
  contracts: {
    id: string;
    type: string;
    reference: string | null;
    startDate: string;
    endDate: string | null;
    recurringCost: string;
    recurringInterval: string;
    state: string;
  }[];
  services: {
    id: string;
    type: string;
    date: string;
    cost: string;
    state: string;
    moveId: string | null;
  }[];
  bookings: {
    id: string;
    number: string | null;
    subject: string;
    dateFrom: string | null;
    dateTo: string | null;
    state: string;
    employee: string | null;
  }[];
  costsThisYear: number;
}

const CONTRACT_STATE: Record<string, [string, string]> = {
  new: ["Baru", "New"],
  running: ["Berjalan", "Running"],
  expired: ["Kedaluwarsa", "Expired"],
  closed: ["Ditutup", "Closed"],
};
const SERVICE_STATE: Record<string, [string, string]> = {
  new: ["Baru", "New"],
  running: ["Dikerjakan", "Running"],
  done: ["Selesai", "Done"],
  cancelled: ["Dibatalkan", "Cancelled"],
};
const INTERVAL: Record<string, [string, string]> = {
  none: ["", ""],
  daily: ["/hari", "/day"],
  weekly: ["/minggu", "/week"],
  monthly: ["/bulan", "/month"],
  yearly: ["/tahun", "/year"],
};

const km = (v: string | number, unit: string, locale: string) =>
  `${Number(v).toLocaleString(locale)} ${unit}`;

/** Panel di bawah form kendaraan: pengemudi & riwayat, odometer, kontrak, servis, peminjaman, biaya tahun ini. */
export function VehicleExtras({ id }: { id: string }) {
  const { l, locale } = useI18n();
  const me = useMe();
  const write = can(me.permissions, "fleet.write");
  const [o, setO] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [driver, setDriver] = useState("");
  const [reading, setReading] = useState({ date: today(), value: "", note: "" });
  const load = useCallback(
    () =>
      api<Overview>(`/fleet/vehicles/${id}/overview`).then(
        (r) => {
          setO(r);
          setDriver(r.vehicle.driverEmployeeId ?? "");
        },
        (e) => setError(errorText(e)),
      ),
    [id],
  );
  useEffect(() => {
    void load();
  }, [load]);
  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  }
  if (!o)
    return error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : null;
  const unit = o.vehicle.odometerUnit;
  return (
    <>
      <section className="panel">
        <h2>{l("Ringkasan kendaraan", "Vehicle summary")}</h2>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="cards">
          <div className="card">
            <span>{l("Model", "Model")}</span>
            <strong>{o.model ? `${o.model.manufacturer} ${o.model.name}` : "—"}</strong>
          </div>
          <div className="card">
            <span>{l("Odometer", "Odometer")}</span>
            <strong>{km(o.vehicle.odometer, unit, locale)}</strong>
          </div>
          <div className="card">
            <span>{l("Biaya tahun ini", "Cost this year")}</span>
            <strong>{money(o.costsThisYear, locale, 0)}</strong>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>{l("Pengemudi", "Driver")}</h2>
        {write && (
          <div className="inline-panel">
            <label className="field">
              <span>{l("Pengemudi saat ini", "Current driver")}</span>
              <RefSelect
                name="driver"
                resource="employees"
                display="name"
                value={driver}
                onChange={setDriver}
              />
            </label>
            <button
              type="button"
              className="primary"
              disabled={driver === (o.vehicle.driverEmployeeId ?? "")}
              onClick={() =>
                run(() =>
                  api(`/fleet/vehicles/${id}/driver`, {
                    method: "POST",
                    body: { employeeId: driver || null },
                  }),
                )
              }
            >
              {l("Ganti pengemudi", "Change driver")}
            </button>
          </div>
        )}
        {o.drivers.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{l("Pengemudi", "Driver")}</th>
                  <th>{l("Mulai", "From")}</th>
                  <th>{l("Selesai", "Until")}</th>
                </tr>
              </thead>
              <tbody>
                {o.drivers.map((d) => (
                  <tr key={d.id}>
                    <td>{d.name}</td>
                    <td>{formatDate(d.startDate, locale)}</td>
                    <td>{d.endDate ? formatDate(d.endDate, locale) : l("Sekarang", "Current")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">{l("Belum ada pengemudi.", "No driver yet.")}</p>
        )}
      </section>

      <section className="panel">
        <h2>{l("Odometer", "Odometer")}</h2>
        {write && (
          <div className="inline-panel">
            <label className="field">
              <span>{l("Tanggal", "Date")}</span>
              <input
                type="date"
                value={reading.date}
                onChange={(e) => setReading({ ...reading, date: e.target.value })}
              />
            </label>
            <label className="field">
              <span>
                {l("Pembacaan", "Reading")} ({unit})
              </span>
              <input
                type="number"
                min={0}
                value={reading.value}
                onChange={(e) => setReading({ ...reading, value: e.target.value })}
              />
            </label>
            <label className="field">
              <span>{l("Catatan", "Note")}</span>
              <input
                value={reading.note}
                onChange={(e) => setReading({ ...reading, note: e.target.value })}
              />
            </label>
            <button
              type="button"
              className="primary"
              disabled={!reading.value}
              onClick={() =>
                run(async () => {
                  await api(`/fleet/vehicles/${id}/odometers`, {
                    method: "POST",
                    body: { date: reading.date, value: Number(reading.value), note: reading.note || null },
                  });
                  setReading({ date: today(), value: "", note: "" });
                })
              }
            >
              {l("Catat", "Log")}
            </button>
          </div>
        )}
        {o.odometers.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{l("Tanggal", "Date")}</th>
                  <th className="num">{l("Pembacaan", "Reading")}</th>
                  <th>{l("Pengemudi", "Driver")}</th>
                  <th>{l("Catatan", "Note")}</th>
                </tr>
              </thead>
              <tbody>
                {o.odometers.map((r) => (
                  <tr key={r.id}>
                    <td>{formatDate(r.date, locale)}</td>
                    <td className="num">{km(r.value, unit, locale)}</td>
                    <td>{r.driver ?? "—"}</td>
                    <td>{r.note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>{l("Kontrak", "Contracts")}</h2>
        {o.contracts.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{l("Jenis", "Type")}</th>
                  <th>{l("Periode", "Period")}</th>
                  <th className="num">{l("Biaya berulang", "Recurring cost")}</th>
                  <th>{l("Status", "Status")}</th>
                </tr>
              </thead>
              <tbody>
                {o.contracts.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/fleet-contracts/${c.id}`}>
                        {c.type}
                        {c.reference ? ` · ${c.reference}` : ""}
                      </Link>
                    </td>
                    <td>
                      {formatDate(c.startDate, locale)} – {c.endDate ? formatDate(c.endDate, locale) : "…"}
                    </td>
                    <td className="num">
                      {Number(c.recurringCost)
                        ? `${money(c.recurringCost, locale, 0)}${l(...(INTERVAL[c.recurringInterval] ?? ["", ""]))}`
                        : "—"}
                    </td>
                    <td>
                      <span className={`badge ${c.state === "expired" ? "warn" : ""}`}>
                        {l(...(CONTRACT_STATE[c.state] ?? [c.state, c.state]))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">{l("Belum ada kontrak.", "No contracts yet.")}</p>
        )}
      </section>

      <section className="panel">
        <h2>{l("Servis", "Services")}</h2>
        {o.services.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{l("Tanggal", "Date")}</th>
                  <th>{l("Jenis", "Type")}</th>
                  <th className="num">{l("Biaya", "Cost")}</th>
                  <th>{l("Status", "Status")}</th>
                </tr>
              </thead>
              <tbody>
                {o.services.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link href={`/fleet-services/${s.id}`}>{formatDate(s.date, locale)}</Link>
                    </td>
                    <td>{s.type}</td>
                    <td className="num">{money(s.cost, locale, 0)}</td>
                    <td>
                      {l(...(SERVICE_STATE[s.state] ?? [s.state, s.state]))}
                      {s.moveId ? ` · ${l("ditagihkan", "billed")}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">{l("Belum ada servis.", "No services yet.")}</p>
        )}
      </section>

      {o.bookings.length > 0 && (
        <section className="panel">
          <h2>{l("Peminjaman (Persetujuan)", "Bookings (Approvals)")}</h2>
          <ul className="plain-list">
            {o.bookings.map((b) => (
              <li key={b.id}>
                <strong>{b.number ?? b.subject}</strong> · {b.employee ?? "—"} ·{" "}
                {b.dateFrom ? formatDate(b.dateFrom, locale) : ""}
                {b.dateTo ? ` – ${formatDate(b.dateTo, locale)}` : ""} ·{" "}
                <span className="muted">{b.state}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** Tombol tutup & perpanjang di form kontrak kendaraan. */
export function ContractActions({ id }: { id: string }) {
  const { l } = useI18n();
  const me = useMe();
  const [c, setC] = useState<{ state: string; endDate: string | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () => api<{ state: string; endDate: string | null }>(`/fleet-contracts/${id}`).then(setC),
    [id],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (!c || !can(me.permissions, "fleet.write") || c.state === "closed") return null;
  const act = (path: string, done: string) =>
    api<{ id: string }>(`/fleet/contracts/${id}/${path}`, { method: "POST" }).then(
      (r) => {
        setNotice(done);
        if (path === "renew") window.location.assign(`/fleet-contracts/${r.id}`);
        else void load();
      },
      (e) => setError(errorText(e)),
    );
  return (
    <section className="panel">
      <h2>{l("Tindakan kontrak", "Contract actions")}</h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="success">{notice}</p>}
      <div className="form-actions">
        {c.endDate && (
          <button
            type="button"
            className="primary"
            onClick={() => act("renew", l("Diperpanjang.", "Renewed."))}
          >
            {l("Perpanjang", "Renew")}
          </button>
        )}
        <button
          type="button"
          onClick={async () =>
            (await ask(l("Tutup kontrak ini?", "Close this contract?"))) &&
            act("close", l("Ditutup.", "Closed."))
          }
        >
          {l("Tutup kontrak", "Close contract")}
        </button>
      </div>
    </section>
  );
}

/** Tagihan vendor dari servis (draft di Akuntansi). */
export function ServiceBillPanel({ id }: { id: string }) {
  const { l } = useI18n();
  const me = useMe();
  const [s, setS] = useState<{ moveId: string | null; state: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () => api<{ moveId: string | null; state: string }>(`/fleet-services/${id}`).then(setS),
    [id],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (!s) return null;
  const allowed = can(me.permissions, "fleet.manage") && can(me.permissions, "accounting.write");
  return (
    <section className="panel">
      <h2>{l("Tagihan vendor", "Vendor bill")}</h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {s.moveId ? (
        <p>
          <Link href={`/accounting/moves/${s.moveId}`}>{l("Buka tagihan vendor", "Open vendor bill")}</Link>
        </p>
      ) : allowed && s.state !== "cancelled" ? (
        <button
          type="button"
          className="primary"
          onClick={() =>
            api(`/fleet/services/${id}/bill`, { method: "POST" }).then(
              () => void load(),
              (e) => setError(errorText(e)),
            )
          }
        >
          {l("Buat tagihan vendor", "Create vendor bill")}
        </button>
      ) : (
        <p className="muted">
          {l(
            "Tagihan dibuat oleh pengguna dengan hak armada & akuntansi.",
            "Bills are created by users with fleet & accounting rights.",
          )}
        </p>
      )}
    </section>
  );
}

/** Panel di halaman karyawan: kendaraan yang (pernah) dikemudikan. */
export function EmployeeVehiclesPanel({ employeeId }: { employeeId: string }) {
  const { l, locale } = useI18n();
  const [rows, setRows] = useState<
    {
      vehicleId: string;
      licensePlate: string;
      model: string;
      startDate: string;
      endDate: string | null;
    }[]
  >([]);
  useEffect(() => {
    void api<typeof rows>(`/fleet/employees/${employeeId}/vehicles`).then(setRows, () => setRows([]));
  }, [employeeId]);
  if (!rows.length) return null;
  return (
    <section className="panel">
      <h2>{l("Kendaraan", "Vehicles")}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{l("Kendaraan", "Vehicle")}</th>
              <th>{l("Mulai", "From")}</th>
              <th>{l("Selesai", "Until")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.vehicleId}-${r.startDate}`}>
                <td>
                  <Link href={`/fleet-vehicles/${r.vehicleId}`}>
                    {r.licensePlate} · {r.model}
                  </Link>
                </td>
                <td>{formatDate(r.startDate, locale)}</td>
                <td>{r.endDate ? formatDate(r.endDate, locale) : l("Sekarang", "Current")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface MyVehicle {
  id: string;
  licensePlate: string;
  model: string;
  manufacturer: string;
  odometer: string;
  odometerUnit: string;
  stnkExpiry: string | null;
  taxDueDate: string | null;
  kirExpiry: string | null;
}

/** Portal: kendaraan yang sedang dikemudikan + catat odometer. */
export function MyVehiclesPanel() {
  const { l, locale } = useI18n();
  const [rows, setRows] = useState<MyVehicle[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(() => api<MyVehicle[]>("/me/vehicles").then(setRows, () => setRows([])), []);
  useEffect(() => {
    void load();
  }, [load]);
  if (!rows.length) return null;
  return (
    <section className="panel">
      <h2>{l("Kendaraan saya", "My vehicles")}</h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="success">{notice}</p>}
      {rows.map((v) => (
        <div key={v.id} className="my-vehicle">
          <div>
            <strong>{v.licensePlate}</strong> · {v.manufacturer} {v.model}
            <div className="muted">
              {l("Odometer", "Odometer")}: {km(v.odometer, v.odometerUnit, locale)}
              {v.stnkExpiry ? ` · STNK ${formatDate(v.stnkExpiry, locale)}` : ""}
              {v.taxDueDate ? ` · ${l("Pajak", "Tax")} ${formatDate(v.taxDueDate, locale)}` : ""}
            </div>
          </div>
          <div className="inline-panel">
            <label className="field">
              <span>
                {l("Odometer hari ini", "Today's odometer")} ({v.odometerUnit})
              </span>
              <input
                type="number"
                min={0}
                value={values[v.id] ?? ""}
                onChange={(e) => setValues({ ...values, [v.id]: e.target.value })}
              />
            </label>
            <button
              type="button"
              className="primary"
              disabled={!values[v.id]}
              onClick={() => {
                setError(null);
                api(`/me/vehicles/${v.id}/odometers`, {
                  method: "POST",
                  body: { date: today(), value: Number(values[v.id]) },
                }).then(
                  () => {
                    setNotice(l("Odometer tercatat.", "Odometer logged."));
                    setValues({ ...values, [v.id]: "" });
                    void load();
                  },
                  (e) => setError(errorText(e)),
                );
              }}
            >
              {l("Catat", "Log")}
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

const yearStart = () => `${today().slice(0, 4)}-01-01`;

/** Laporan biaya armada (kontrak + servis) per kendaraan/kategori/bulan & tren odometer. */
export function FleetReports() {
  const { l, locale } = useI18n();
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(today());
  const [groupBy, setGroupBy] = useState("vehicle");
  const [costs, setCosts] = useState<{
    groups: { key: string; label: string; contract: number; service: number; total: number }[];
    total: number;
  } | null>(null);
  const [odo, setOdo] = useState<{ vehicleId: string; licensePlate: string; month: string; value: number }[]>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setError(null);
    const q = `from=${from}&to=${to}`;
    api<NonNullable<typeof costs>>(`/fleet/reports/costs?${q}&groupBy=${groupBy}`).then(setCosts, (e) =>
      setError(errorText(e)),
    );
    api<typeof odo>(`/fleet/reports/odometer?${q}`).then(setOdo, () => setOdo([]));
  }, [from, to, groupBy]);
  const CATEGORY: Record<string, [string, string]> = {
    car: ["Mobil", "Car"],
    motorcycle: ["Sepeda motor", "Motorcycle"],
    pickup: ["Pikap", "Pickup"],
    truck: ["Truk", "Truck"],
    bus: ["Bus", "Bus"],
    other: ["Lainnya", "Other"],
  };
  const label = (g: { label: string }) =>
    groupBy === "category" ? l(...(CATEGORY[g.label] ?? [g.label, g.label])) : g.label;
  const max = Math.max(1, ...(costs?.groups.map((g) => g.total) ?? [1]));
  const [drill, setDrill] = useState<DatasetDrillRequest | null>(null);
  /** Kejadian biaya (kontrak/servis) penyusun satu kelompok; `source` membatasi ke salah satu sumber. */
  const drillCell = (g: { key: string; label: string }, value: number, source?: "Kontrak" | "Servis") =>
    value ? (
      <button
        type="button"
        className="link drill"
        onClick={() =>
          setDrill({
            title: label(g),
            body: {
              dataset: "fleet_costs",
              filters: { from, to },
              match: {
                ...(groupBy === "vehicle"
                  ? { _vehicleId: g.key }
                  : groupBy === "category"
                    ? { _category: g.key }
                    : { month: g.key }),
                ...(source ? { source } : {}),
              },
            },
          })
        }
      >
        {money(value, locale, 0)}
      </button>
    ) : (
      money(value, locale, 0)
    );
  return (
    <>
      <section className="panel">
        <h2>{l("Biaya Armada", "Fleet Costs")}</h2>
        <div className="inline-panel">
          <label className="field">
            <span>{l("Dari", "From")}</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field">
            <span>{l("Sampai", "To")}</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="field">
            <span>{l("Kelompokkan per", "Group by")}</span>
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              <option value="vehicle">{l("Kendaraan", "Vehicle")}</option>
              <option value="category">{l("Kategori", "Category")}</option>
              <option value="month">{l("Bulan", "Month")}</option>
            </select>
          </label>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {costs && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>
                    {groupBy === "month"
                      ? l("Bulan", "Month")
                      : groupBy === "category"
                        ? l("Kategori", "Category")
                        : l("Kendaraan", "Vehicle")}
                  </th>
                  <th className="num">{l("Kontrak", "Contracts")}</th>
                  <th className="num">{l("Servis", "Services")}</th>
                  <th className="num">{l("Total", "Total")}</th>
                  <th className="bar-col" />
                </tr>
              </thead>
              <tbody>
                {costs.groups.map((g) => (
                  <tr key={g.key}>
                    <td>{label(g)}</td>
                    <td className="num">{drillCell(g, g.contract, "Kontrak")}</td>
                    <td className="num">{drillCell(g, g.service, "Servis")}</td>
                    <td className="num">
                      <strong>{drillCell(g, g.total)}</strong>
                    </td>
                    <td className="bar-col">
                      <span className="cost-bar" style={{ width: `${(g.total / max) * 100}%` }} />
                    </td>
                  </tr>
                ))}
                {!costs.groups.length && (
                  <tr>
                    <td colSpan={5} className="muted">
                      {l("Tidak ada biaya pada periode ini.", "No costs in this period.")}
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <th>{l("Total", "Total")}</th>
                  <th />
                  <th />
                  <th className="num">{money(costs.total, locale, 0)}</th>
                  <th />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <DatasetDrillPanel request={drill} onClose={() => setDrill(null)} />
      </section>
      <section className="panel">
        <h2>{l("Tren Odometer", "Odometer Trend")}</h2>
        {odo.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{l("Kendaraan", "Vehicle")}</th>
                  <th>{l("Bulan", "Month")}</th>
                  <th className="num">{l("Pembacaan tertinggi", "Highest reading")}</th>
                </tr>
              </thead>
              <tbody>
                {odo.map((r) => (
                  <tr key={`${r.vehicleId}-${r.month}`}>
                    <td>
                      <Link href={`/fleet-vehicles/${r.vehicleId}`}>{r.licensePlate}</Link>
                    </td>
                    <td>{r.month}</td>
                    <td className="num">{r.value.toLocaleString(locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">{l("Belum ada pembacaan odometer.", "No odometer readings yet.")}</p>
        )}
      </section>
    </>
  );
}

/** Dokumen kendaraan & kontrak yang akan/sudah kedaluwarsa. */
export function FleetReminders() {
  const { l, locale } = useI18n();
  const [days, setDays] = useState("");
  const [rows, setRows] = useState<
    {
      kind: string;
      id: string;
      vehicleId: string;
      licensePlate: string;
      name: string;
      date: string;
      daysLeft: number;
    }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<typeof rows>(`/fleet/reminders${days ? `?days=${days}` : ""}`).then(setRows, (e) =>
      setError(errorText(e)),
    );
  }, [days]);
  const KIND: Record<string, [string, string]> = {
    stnk: ["STNK", "Registration (STNK)"],
    tax: ["Pajak tahunan", "Annual tax"],
    kir: ["KIR", "KIR test"],
    contract: ["Kontrak", "Contract"],
  };
  return (
    <section className="panel">
      <h2>{l("Pengingat Dokumen & Kontrak", "Document & Contract Reminders")}</h2>
      <div className="inline-panel">
        <label className="field">
          <span>{l("Dalam (hari)", "Within (days)")}</span>
          <input
            type="number"
            min={1}
            max={365}
            placeholder={l("bawaan", "default")}
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        </label>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {rows.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l("Kendaraan", "Vehicle")}</th>
                <th>{l("Dokumen", "Document")}</th>
                <th>{l("Tanggal", "Date")}</th>
                <th className="num">{l("Sisa hari", "Days left")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.kind}-${r.id}`}>
                  <td>
                    <Link href={`/fleet-vehicles/${r.vehicleId}`}>{r.licensePlate}</Link>
                  </td>
                  <td>
                    {l(...(KIND[r.kind] ?? [r.kind, r.kind]))}
                    {r.kind === "contract" ? ` · ${r.name}` : ""}
                  </td>
                  <td>{formatDate(r.date, locale)}</td>
                  <td className="num">
                    <span className={`badge ${r.daysLeft < 0 ? "danger" : r.daysLeft <= 7 ? "warn" : ""}`}>
                      {r.daysLeft < 0 ? l(`lewat ${-r.daysLeft}`, `${-r.daysLeft} overdue`) : r.daysLeft}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">
          {l("Tidak ada dokumen yang akan kedaluwarsa.", "Nothing is about to expire.")}
        </p>
      )}
    </section>
  );
}

/** Pengaturan armada per perusahaan. */
export function FleetSettingsForm() {
  const { l } = useI18n();
  const [s, setS] = useState<{ reminderDays: number; expenseAccountId: string | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<NonNullable<typeof s>>("/fleet/settings").then(setS, (e) => setError(errorText(e)));
  }, []);
  if (!s)
    return error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : null;
  return (
    <section className="panel">
      <h2>{l("Pengaturan Armada", "Fleet Settings")}</h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="success">{notice}</p>}
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          api<typeof s>("/fleet/settings", { method: "PUT", body: s }).then(
            (r) => {
              setS(r);
              setNotice(l("Tersimpan.", "Saved."));
            },
            (err) => setError(errorText(err)),
          );
        }}
      >
        <label className="field">
          <span>
            {l("Ingatkan dokumen & kontrak (hari sebelumnya)", "Remind documents & contracts (days before)")}
          </span>
          <input
            type="number"
            min={1}
            max={365}
            value={s.reminderDays}
            onChange={(e) => setS({ ...s, reminderDays: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>
            {l("Akun beban armada bawaan (tagihan servis)", "Default fleet expense account (service bills)")}
          </span>
          <RefSelect
            name="expenseAccountId"
            resource="accounts"
            display="name"
            value={s.expenseAccountId ?? ""}
            onChange={(v) => setS({ ...s, expenseAccountId: v || null })}
          />
        </label>
        <p className="muted">
          {l(
            "Pengingat dikirim sebagai notifikasi in-app setiap hari ke fleet manager kendaraan dan pengguna dengan hak fleet.manage. Tanpa akun beban, tagihan memakai akun bawaan jurnal pembelian.",
            "Reminders are sent daily as in-app notifications to each vehicle's fleet manager and users with fleet.manage. Without an expense account, bills use the purchase journal's default account.",
          )}
        </p>
        <div className="form-actions">
          <button type="submit" className="primary">
            {l("Simpan", "Save")}
          </button>
        </div>
      </form>
    </section>
  );
}
