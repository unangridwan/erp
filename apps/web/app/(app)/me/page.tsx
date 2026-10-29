"use client";

import { useEffect, useState } from "react";
import { download } from "../../../components/accounting/download";
import {
  MyApprovalRequests,
  MyAppraisals,
  MyChangeRequest,
  MyChecklistTasks,
  MyClaims,
  MyLoans,
  MyOvertime,
  MyProfile,
  MyTaxSlips,
} from "../../../components/hr/portal-extras";
import { MyAttendance } from "../../../components/hr/attendance-extras";
import { MyVehiclesPanel } from "../../../components/fleet/fleet-panels";
import { ProjectsPanel } from "../../../components/hr/projects-panel";
import { BenefitEnrollments } from "../../../components/payroll/benefits-panel";
import { AnnouncementsFeed, FeedbackInbox, GoalTree, WhosOffPanel } from "../../../components/hr/ess-panels";
import { LeaveRequestForm, type LeaveTypeOption } from "../../../components/hr/leave-form";
import { api, ApiError } from "../../../lib/api";
import { formatDate, money } from "../../../lib/format";
import { useI18n } from "../../../lib/i18n";
import { LEAVE_STATE_LABEL } from "../../../lib/resources";

interface Employee {
  name: string;
  employeeNumber: string;
  workEmail: string | null;
  ptkpStatus: string;
  openAttendance: { checkIn: string } | null;
}
interface Leaves {
  requests: {
    id: string;
    leaveTypeName: string;
    dateFrom: string;
    dateTo: string;
    days: string;
    state: string;
  }[];
  balances: {
    leaveTypeId: string;
    leaveTypeName: string;
    allocated: string;
    taken: string;
    remaining: string;
    expiringSoon: string;
    expiringOn: string | null;
  }[];
}
interface Slip {
  id: string;
  runName: string;
  periodStart: string;
  paymentDate: string;
  net: string;
}

/** Portal karyawan: absen, cuti, lembur, klaim biaya, pinjaman, slip gaji, bukti potong A1, perubahan data. */
export default function MyPortalPage() {
  const { l, tx, locale } = useI18n();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [leaves, setLeaves] = useState<Leaves | null>(null);
  const [slips, setSlips] = useState<Slip[]>([]);
  const [types, setTypes] = useState<LeaveTypeOption[]>([]);
  const [colleagues, setColleagues] = useState<{ id: string; name: string }[]>([]);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notLinked, setNotLinked] = useState(false);

  useEffect(() => {
    api<Employee>("/me/employee")
      .then((e) => {
        setEmployee(e);
        return Promise.all([
          api<Leaves>("/me/leaves").then(setLeaves),
          api<Slip[]>("/me/payslips").then(setSlips),
          api<LeaveTypeOption[]>("/me/leave-types").then(setTypes),
          api<{ id: string; name: string }[]>("/me/colleagues").then(setColleagues),
        ]);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404) setNotLinked(true);
        else setError(e instanceof Error ? e.message : String(e));
      });
  }, [version]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      setVersion((v) => v + 1);
    } catch (e) {
      setError(
        e instanceof ApiError && Object.values(e.fieldErrors)[0]
          ? Object.values(e.fieldErrors)[0]!
          : e instanceof Error
            ? e.message
            : String(e),
      );
    }
  }

  if (notLinked)
    return (
      <div className="panel narrow">
        <h1>{l("Portal Saya", "My Portal")}</h1>
        <p className="muted">
          {l(
            'Akun Anda belum terhubung dengan data karyawan. Minta HR mengisi "Akun login" pada data karyawan Anda.',
            "Your account is not linked to an employee record yet. Ask HR to set the user account on your employee record.",
          )}
        </p>
      </div>
    );
  if (!employee) return <p className="muted">{error ?? l("Memuat…", "Loading…")}</p>;

  return (
    <div className="stack-wide">
      <AnnouncementsFeed />
      <section className="panel">
        <header className="toolbar">
          <h1>
            {employee.name} <small className="muted">{employee.employeeNumber}</small>
          </h1>
          {employee.openAttendance ? (
            <button
              type="button"
              className="danger"
              onClick={() => run(() => api("/attendance/check-out", { method: "POST" }))}
            >
              {l("Absen pulang", "Check out")}
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              onClick={() =>
                run(
                  () =>
                    new Promise((resolve, reject) => {
                      // Lokasi opsional: bila izin tidak dijawab/ditolak, absen tetap dikirim tanpa koordinat.
                      let sent = false;
                      const send = (coords?: GeolocationCoordinates) => {
                        if (sent) return;
                        sent = true;
                        api("/attendance/check-in", {
                          method: "POST",
                          body: coords ? { latitude: coords.latitude, longitude: coords.longitude } : {},
                        }).then(resolve, reject);
                      };
                      setTimeout(() => send(), 4000);
                      if (!navigator.geolocation) return send();
                      navigator.geolocation.getCurrentPosition(
                        (p) => send(p.coords),
                        () => send(),
                        { timeout: 3000 },
                      );
                    }),
                )
              }
            >
              {l("Absen masuk", "Check in")}
            </button>
          )}
        </header>
        {employee.openAttendance && (
          <p className="notice">
            {l("Masuk sejak", "Checked in since")}{" "}
            {new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", { timeStyle: "short" }).format(
              new Date(employee.openAttendance.checkIn),
            )}
          </p>
        )}
        {error && <p className="error">{error}</p>}
      </section>

      <section className="panel">
        <h2>{l("Cuti", "Time off")}</h2>
        <ul className="grid">
          {leaves?.balances.map((b) => (
            <li key={b.leaveTypeId} className="card">
              <span>{b.leaveTypeName}</span>
              <strong>
                {Number(b.remaining)} / {Number(b.allocated)} {l("hari tersisa", "days left")}
              </strong>
              {Number(b.expiringSoon) > 0 && (
                <small className="muted">
                  {l(
                    `${Number(b.expiringSoon)} hari hangus ${formatDate(b.expiringOn, locale)}`,
                    `${Number(b.expiringSoon)} days expire ${formatDate(b.expiringOn, locale)}`,
                  )}
                </small>
              )}
            </li>
          ))}
        </ul>
        <LeaveRequestForm types={types} colleagues={colleagues} onSaved={() => setVersion((v) => v + 1)} />
        <div className="table-wrap">
          <table>
            <tbody>
              {leaves?.requests.map((r) => (
                <tr key={r.id}>
                  <td>{r.leaveTypeName}</td>
                  <td>
                    {formatDate(r.dateFrom, locale)} – {formatDate(r.dateTo, locale)}
                  </td>
                  <td className="num">
                    {Number(r.days)} {l("hari", "days")}
                  </td>
                  <td>{tx(LEAVE_STATE_LABEL[r.state]!)}</td>
                  <td>
                    {(r.state === "confirm" || r.state === "approved") && (
                      <button
                        type="button"
                        className="link"
                        onClick={() => run(() => api(`/leaves/${r.id}/cancel`, { method: "POST" }))}
                      >
                        {l("Batalkan", "Cancel")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <MyProfile name={employee.name} />
      <MyAppraisals />
      <section className="panel">
        <h2>{l("Sasaran saya", "My goals")}</h2>
        <GoalTree path="/me/goals" allowCreate={false} />
      </section>
      <BenefitEnrollments mine />
      <ProjectsPanel mine />
      <FeedbackInbox />
      <WhosOffPanel />
      <MyVehiclesPanel />
      <MyChecklistTasks />
      <MyOvertime />
      <MyAttendance />
      <MyClaims />
      <MyApprovalRequests />
      <MyLoans />

      <section className="panel">
        <h2>{l("Slip gaji", "Payslips")}</h2>
        {slips.length === 0 ? (
          <p className="muted">{l("Belum ada slip gaji.", "No payslips yet.")}</p>
        ) : (
          <table>
            <tbody>
              {slips.map((s) => (
                <tr key={s.id}>
                  <td>{s.runName}</td>
                  <td>{formatDate(s.paymentDate, locale)}</td>
                  <td className="num">{money(s.net, locale)}</td>
                  <td>
                    <button
                      type="button"
                      className="link"
                      onClick={() =>
                        run(() => download(`/payslips/${s.id}/pdf`, `slip-${s.periodStart.slice(0, 7)}.pdf`))
                      }
                    >
                      PDF
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <MyTaxSlips />
      <MyChangeRequest />
    </div>
  );
}
