"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useOptions } from "../../../../components/accounting/use-options";
import { useMe } from "../../../../components/me-context";
import { RefSelect } from "../../../../components/ref-select";
import { api, ApiError } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";
import { SortTh, TablePager, TableTools, type ViewColumn } from "../../../../components/data-table";
import { useTableView } from "../../../../lib/use-table-view";

interface Device {
  id: string;
  name: string;
  serial: string | null;
  workLocationId: string | null;
  active: boolean;
  lastSeenAt: string | null;
}

/**
 * Mesin absensi (fingerprint/face, mis. ZKTeco, Hikvision) yang mengirim log ke `POST /attendance-devices/push`
 * dengan header `X-Device-Key`. Kunci hanya ditampilkan sekali; PIN kiosk karyawan diatur di sini.
 */
export default function AttendanceDevicesPage() {
  const { l, locale } = useI18n();
  const me = useMe();
  const manage = can(me.permissions, "hr.manage");
  const locations = useOptions<{ id: string; name: string }>("/work-locations");
  const [rows, setRows] = useState<Device[]>([]);
  const [form, setForm] = useState({ name: "", serial: "", workLocationId: "" });
  const [key, setKey] = useState<{ name: string; key: string } | null>(null);
  const [pin, setPin] = useState({ employeeId: "", pin: "" });
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const columns = useMemo<ViewColumn<Device>[]>(
    () => [
      { key: "name", label: l("Nama", "Name"), value: (d) => d.name },
      { key: "serial", label: l("No. seri", "Serial no."), value: (d) => d.serial },
      {
        key: "location",
        label: l("Lokasi", "Location"),
        type: "enum",
        value: (d) => locations.find((x) => x.id === d.workLocationId)?.name ?? null,
      },
      {
        key: "lastSeenAt",
        label: l("Terakhir terhubung", "Last seen"),
        type: "date",
        value: (d) => d.lastSeenAt,
      },
    ],
    [l, locations],
  );
  const table = useTableView(rows, columns, { storageKey: "attendance-devices" });

  useEffect(() => {
    api<Device[]>("/attendance-devices").then(setRows, (e: Error) => setError(e.message));
  }, [version]);

  async function run(fn: () => Promise<void>) {
    setError(null);
    setNotice(null);
    try {
      await fn();
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof ApiError ? (Object.values(e.fieldErrors)[0] ?? e.message) : String(e));
    }
  }
  const create = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const d = await api<Device & { key: string }>("/attendance-devices", {
        method: "POST",
        body: {
          name: form.name,
          serial: form.serial || null,
          workLocationId: form.workLocationId || null,
          active: true,
        },
      });
      setKey({ name: d.name, key: d.key });
      setForm({ name: "", serial: "", workLocationId: "" });
    });
  };
  const savePin = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api(`/employees/${pin.employeeId}/attendance-pin`, { method: "PUT", body: { pin: pin.pin } });
      setPin({ employeeId: "", pin: "" });
      setNotice(l("PIN kiosk karyawan disimpan.", "Employee kiosk PIN saved."));
    });
  };
  const seen = (v: string | null) =>
    v
      ? new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(v))
      : l("belum pernah", "never");

  return (
    <div className="stack-wide">
      <section className="panel">
        <header className="toolbar">
          <h1>{l("Mesin Absensi", "Attendance Devices")}</h1>
        </header>
        <p className="muted">
          {l(
            "Mesin mengirim log ke POST /attendance-devices/push dengan header X-Device-Key dan isi { punches: [{ code, timestamp }] } (code = kode badge atau No. karyawan). Log yang sama aman dikirim ulang.",
            "Devices send logs to POST /attendance-devices/push with header X-Device-Key and body { punches: [{ code, timestamp }] } (code = badge or employee no.). Re-sending the same log is safe.",
          )}
        </p>
        {error && <p className="error">{error}</p>}
        {notice && <p className="notice">{notice}</p>}
        {key && (
          <div className="notice">
            <strong>
              {l(
                `Kunci API ${key.name} — simpan sekarang, tidak ditampilkan lagi:`,
                `API key for ${key.name} — save it now, it will not be shown again:`,
              )}
            </strong>
            <pre className="device-key">{key.key}</pre>
            <button
              type="button"
              className="link"
              onClick={() => void navigator.clipboard?.writeText(key.key)}
            >
              {l("Salin", "Copy")}
            </button>
          </div>
        )}
        {manage && (
          <form className="inline-panel" onSubmit={create}>
            <label className="field">
              <span>{l("Nama", "Name")}</span>
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="field">
              <span>{l("No. seri", "Serial no.")}</span>
              <input value={form.serial} onChange={(e) => setForm({ ...form, serial: e.target.value })} />
            </label>
            <label className="field">
              <span>{l("Lokasi kerja", "Work location")}</span>
              <select
                value={form.workLocationId}
                onChange={(e) => setForm({ ...form, workLocationId: e.target.value })}
              >
                <option value="">—</option>
                {locations.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary">{l("Daftarkan mesin", "Register device")}</button>
          </form>
        )}
        <TableTools view={table} />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <SortTh view={table} col="name">
                  {l("Nama", "Name")}
                </SortTh>
                <SortTh view={table} col="serial">
                  {l("No. seri", "Serial no.")}
                </SortTh>
                <SortTh view={table} col="location">
                  {l("Lokasi", "Location")}
                </SortTh>
                <SortTh view={table} col="lastSeenAt">
                  {l("Terakhir terhubung", "Last seen")}
                </SortTh>
                <th />
              </tr>
            </thead>
            <tbody>
              {table.rows.map((d) => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td>{d.serial}</td>
                  <td>{locations.find((x) => x.id === d.workLocationId)?.name}</td>
                  <td>{seen(d.lastSeenAt)}</td>
                  <td>
                    {manage && (
                      <>
                        <button
                          type="button"
                          className="link"
                          onClick={() =>
                            confirm(
                              l(
                                "Buat kunci baru? Kunci lama berhenti berlaku.",
                                "Create a new key? The old key stops working.",
                              ),
                            ) &&
                            run(async () => {
                              const r = await api<{ key: string }>(`/attendance-devices/${d.id}/rotate-key`, {
                                method: "POST",
                              });
                              setKey({ name: d.name, key: r.key });
                            })
                          }
                        >
                          {l("Kunci baru", "New key")}
                        </button>{" "}
                        <button
                          type="button"
                          className="link"
                          onClick={() =>
                            confirm(l("Hapus mesin ini?", "Delete this device?")) &&
                            run(async () => {
                              await api(`/attendance-devices/${d.id}`, { method: "DELETE" });
                            })
                          }
                        >
                          {l("Hapus", "Delete")}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {table.rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    {rows.length
                      ? l("Tidak ada data yang cocok dengan filter.", "No rows match the filters.")
                      : l("Belum ada mesin terdaftar.", "No devices yet.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <TablePager view={table} />
      </section>
      {manage && (
        <section className="panel">
          <h2>{l("PIN kiosk karyawan", "Employee kiosk PIN")}</h2>
          <p className="muted">
            {l(
              "Di kiosk karyawan memindai badge (kode badge di data karyawan) atau mengetik No. karyawan, lalu PIN. Karyawan juga bisa mengatur PIN sendiri di Portal Saya.",
              "At the kiosk, employees scan their badge (badge code on the employee record) or type their employee no., then the PIN. Employees can also set their own PIN in My Portal.",
            )}
          </p>
          <form className="inline-panel" onSubmit={savePin}>
            <label className="field">
              <span>{l("Karyawan", "Employee")}</span>
              <RefSelect
                name="employeeId"
                resource="employees"
                display="name"
                required
                value={pin.employeeId}
                onChange={(v) => setPin({ ...pin, employeeId: v })}
              />
            </label>
            <label className="field">
              <span>{l("PIN (4–8 angka)", "PIN (4–8 digits)")}</span>
              <input
                type="password"
                inputMode="numeric"
                pattern="\d{4,8}"
                required
                value={pin.pin}
                onChange={(e) => setPin({ ...pin, pin: e.target.value })}
              />
            </label>
            <button className="primary">{l("Simpan PIN", "Save PIN")}</button>
          </form>
        </section>
      )}
    </div>
  );
}
