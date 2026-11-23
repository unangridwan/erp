"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { LETTER_STATE, openLetterPdf } from "../../../../components/accounting/credit-panel";
import { DataTable, type DataColumn } from "../../../../components/data-table";
import { ask, toast } from "../../../../components/feedback";
import { useMe } from "../../../../components/me-context";
import { api, ApiError } from "../../../../lib/api";
import { formatDate, money, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

interface DueInvoice {
  moveId: string;
  name: string;
  dueDate: string;
  residual: string;
  daysOverdue: number;
  targetLevel: number;
  dunningLevel: number;
}
interface Due {
  partnerId: string;
  partner: string;
  email: string | null;
  level: { sequence: number; name: string; daysOverdue: number };
  invoices: DueInvoice[];
  totalOverdue: string;
}
interface Letter {
  id: string;
  name: string;
  date: string;
  partnerId: string;
  partner: string | null;
  levelSequence: number;
  levelName: string;
  state: "sent" | "failed" | "printed";
  emailTo: string | null;
  currencyCode: string;
  totalOverdue: string;
  invoiceCount: number;
  automatic: boolean;
  sentAt: string | null;
  error: string | null;
}
interface Level {
  id: string;
  sequence: number;
  name: string;
  daysOverdue: number;
  emailSubject: string;
  body: string;
  attachPdf: boolean;
  active: boolean;
}
interface Settings {
  dunningEnabled: boolean;
  dunningMinAmount: string;
}

type Tab = "preview" | "letters" | "levels" | "settings";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Akuntansi › Penagihan (dunning): pratinjau & kirim surat teguran, riwayat, tingkat, pengaturan otomatis. */
export default function DunningPage() {
  return (
    <Suspense>
      <Dunning />
    </Suspense>
  );
}

function Dunning() {
  const { l } = useI18n();
  const me = useMe();
  const params = useSearchParams();
  const partnerFilter = params.get("partnerId");
  const [tab, setTab] = useState<Tab>(partnerFilter ? "letters" : "preview");
  const manage = can(me.permissions, "accounting.manage");
  const tabs: [Tab, string][] = [
    ["preview", l("Perlu ditagih", "To dun")],
    ["letters", l("Riwayat surat", "Letters")],
    ["levels", l("Tingkat", "Levels")],
    ["settings", l("Pengaturan", "Settings")],
  ];

  return (
    <div className="panel">
      <header className="toolbar">
        <h1>{l("Penagihan (Dunning)", "Dunning")}</h1>
        <Link href="/accounting/reports">{l("Umur piutang", "Aged receivables")}</Link>
      </header>
      <p className="muted">
        {l(
          "Surat teguran untuk faktur penjualan yang lewat jatuh tempo. Tingkat naik sesuai umur tunggakan; faktur yang sudah ditagih pada suatu tingkat tidak ditagih ulang pada tingkat yang sama.",
          "Reminder letters for overdue customer invoices. The level rises with the days overdue; an invoice is not dunned twice at the same level.",
        )}
      </p>
      <div className="toolbar">
        <div className="tabs" role="tablist">
          {tabs.map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              className={tab === k ? "active" : ""}
              onClick={() => setTab(k)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {tab === "preview" && <PreviewTab onSent={() => setTab("letters")} />}
      {tab === "letters" && <LettersTab partnerId={partnerFilter} />}
      {tab === "levels" && <LevelsTab writable={manage} />}
      {tab === "settings" && <SettingsTab writable={manage} />}
    </div>
  );
}

function PreviewTab({ onSent }: { onSent: () => void }) {
  const { l, locale } = useI18n();
  const me = useMe();
  const writable = can(me.permissions, "accounting.write");
  const [date, setDate] = useState(today());
  const [rows, setRows] = useState<Due[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    api<Due[]>(`/dunning/preview?date=${date}`).then(
      (r) => {
        setRows(r);
        setSelected(new Set(r.map((x) => x.partnerId)));
      },
      (e: unknown) => setError(errorText(e)),
    );
  }, [date]);

  const send = async () => {
    if (!rows) return;
    const ids = rows.filter((r) => selected.has(r.partnerId)).map((r) => r.partnerId);
    if (!ids.length) return;
    const ok = await ask({
      title: l("Kirim surat teguran", "Send dunning letters"),
      message: l(
        `Kirim surat teguran ke ${ids.length} pelanggan? Pelanggan tanpa email dicatat "gagal kirim" dan suratnya bisa dicetak.`,
        `Send dunning letters to ${ids.length} customers? Customers without an email are recorded as "failed" and their letters can be printed.`,
      ),
      confirmLabel: l("Kirim", "Send"),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const letters = await api<Letter[]>("/dunning/send", {
        method: "POST",
        body: { date, partnerIds: ids },
      });
      const failed = letters.filter((x) => x.state !== "sent").length;
      toast.success(
        l(
          `${letters.length} surat dibuat${failed ? `, ${failed} belum terkirim (lihat riwayat)` : ""}`,
          `${letters.length} letters created${failed ? `, ${failed} not sent (see history)` : ""}`,
        ),
      );
      onSent();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <div className="toolbar">
        <label className="field">
          <span>{l("Tanggal penagihan", "Dunning date")}</span>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        {writable && rows && rows.length > 0 && (
          <button
            type="button"
            className="primary"
            disabled={busy || !selected.size}
            aria-busy={busy}
            onClick={send}
          >
            {l(`Kirim ke ${selected.size} pelanggan`, `Send to ${selected.size} customers`)}
          </button>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!rows ? (
        <p className="muted">{l("Memuat…", "Loading…")}</p>
      ) : rows.length === 0 ? (
        <p className="muted">
          {l(
            "Tidak ada pelanggan yang perlu ditagih pada tanggal ini.",
            "No customers need dunning on this date.",
          )}
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {writable && (
                  <th>
                    <input
                      type="checkbox"
                      aria-label={l("Pilih semua", "Select all")}
                      checked={selected.size === rows.length}
                      onChange={(e) =>
                        setSelected(e.target.checked ? new Set(rows.map((r) => r.partnerId)) : new Set())
                      }
                    />
                  </th>
                )}
                <th>{l("Pelanggan", "Customer")}</th>
                <th>{l("Email", "Email")}</th>
                <th>{l("Tingkat", "Level")}</th>
                <th>{l("Faktur tertunggak", "Overdue invoices")}</th>
                <th className="num">{l("Total tertunggak", "Total overdue")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.partnerId}>
                  {writable && (
                    <td>
                      <input
                        type="checkbox"
                        aria-label={r.partner}
                        checked={selected.has(r.partnerId)}
                        onChange={() => toggle(r.partnerId)}
                      />
                    </td>
                  )}
                  <td>
                    <Link href={`/partners/${r.partnerId}`}>{r.partner}</Link>
                  </td>
                  <td>{r.email ?? <span className="error">{l("kosong", "missing")}</span>}</td>
                  <td>
                    {r.level.sequence}. {r.level.name}
                  </td>
                  <td>
                    {r.invoices.map((i) => (
                      <div key={i.moveId}>
                        <Link href={`/accounting/moves/${i.moveId}`}>{i.name}</Link>{" "}
                        <span className="muted">
                          {formatDate(i.dueDate, locale)} · {i.daysOverdue} {l("hari", "days")} ·{" "}
                          {money(i.residual, locale)}
                        </span>
                      </div>
                    ))}
                  </td>
                  <td className="num">{money(r.totalOverdue, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function LettersTab({ partnerId }: { partnerId: string | null }) {
  const { l, locale } = useI18n();
  const me = useMe();
  const writable = can(me.permissions, "accounting.write");
  const [rows, setRows] = useState<Letter[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Letter[]>(`/dunning-letters${partnerId ? `?partnerId=${partnerId}` : ""}`).then(
      setRows,
      (e: unknown) => setError(errorText(e)),
    );
  }, [partnerId]);
  useEffect(load, [load]);

  const resend = async (r: Letter) => {
    const to = prompt(l("Kirim ke email", "Send to email"), r.emailTo ?? "");
    if (to === null) return;
    try {
      const res = await api<Letter>(`/dunning-letters/${r.id}/resend`, {
        method: "POST",
        body: { to: to.trim() || null },
      });
      if (res.state === "sent") toast.success(l("Surat terkirim", "Letter sent"));
      else toast.error(res.error ?? l("Gagal mengirim", "Failed to send"));
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : errorText(e));
    }
  };

  const columns = useMemo<DataColumn<Letter>[]>(
    () => [
      {
        key: "name",
        label: l("Nomor", "Number"),
        value: (r) => r.name,
        render: (r) => (
          <a href="#" onClick={(e) => void openLetterPdf(e, r.id, r.name).then(load)}>
            {r.name}
          </a>
        ),
      },
      {
        key: "date",
        label: l("Tanggal", "Date"),
        type: "date",
        value: (r) => r.date,
        render: (r) => formatDate(r.date, locale),
      },
      { key: "partner", label: l("Pelanggan", "Customer"), type: "enum", value: (r) => r.partner },
      {
        key: "level",
        label: l("Tingkat", "Level"),
        type: "enum",
        value: (r) => `${r.levelSequence}. ${r.levelName}`,
      },
      {
        key: "total",
        label: l("Tertunggak", "Overdue"),
        type: "number",
        className: "num",
        value: (r) => Number(r.totalOverdue),
        render: (r) => money(r.totalOverdue, locale),
      },
      {
        key: "state",
        label: l("Status", "Status"),
        type: "enum",
        value: (r) => r.state,
        optionLabel: (v) => l(...(LETTER_STATE[v as Letter["state"]] ?? [v, v])),
        text: (r) => l(...LETTER_STATE[r.state]),
        render: (r) => (
          <>
            {l(...LETTER_STATE[r.state])}
            {r.error && <div className="muted small">{r.error}</div>}
          </>
        ),
      },
      {
        key: "source",
        label: l("Dikirim", "Sent by"),
        type: "enum",
        value: (r) => (r.automatic ? "auto" : "manual"),
        text: (r) => (r.automatic ? l("Otomatis", "Automatic") : l("Manual", "Manual")),
        optionLabel: (v) => (v === "auto" ? l("Otomatis", "Automatic") : l("Manual", "Manual")),
      },
      { key: "email", label: l("Email", "Email"), value: (r) => r.emailTo },
      ...(writable
        ? [
            {
              key: "actions",
              label: "",
              value: () => null,
              render: (r: Letter) => (
                <button type="button" className="link" onClick={() => void resend(r)}>
                  {l("Kirim ulang", "Resend")}
                </button>
              ),
            } satisfies DataColumn<Letter>,
          ]
        : []),
    ],
    [l, locale, writable, load],
  );

  if (error)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  if (!rows) return <p className="muted">{l("Memuat…", "Loading…")}</p>;
  return (
    <DataTable
      rows={rows}
      columns={columns}
      storageKey="dunning-letters"
      rowKey={(r) => r.id}
      defaultSort={{ key: "date", dir: "desc" }}
      empty={l("Belum ada surat teguran.", "No dunning letters yet.")}
    />
  );
}

const emptyLevel = (sequence: number): Omit<Level, "id"> => ({
  sequence,
  name: "",
  daysOverdue: 30,
  emailSubject: "",
  body: "",
  attachPdf: true,
  active: true,
});

function LevelsTab({ writable }: { writable: boolean }) {
  const { l } = useI18n();
  const [levels, setLevels] = useState<Level[] | null>(null);
  const [edit, setEdit] = useState<(Omit<Level, "id"> & { id?: string }) | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<Level[]>("/dunning-levels").then(setLevels, (e: unknown) => toast.error(errorText(e)));
  }, []);
  useEffect(load, [load]);

  const save = async () => {
    if (!edit) return;
    setBusy(true);
    setErrors({});
    try {
      const { id, ...body } = edit;
      await api(id ? `/dunning-levels/${id}` : "/dunning-levels", { method: id ? "PUT" : "POST", body });
      toast.success(l("Tingkat disimpan", "Level saved"));
      setEdit(null);
      load();
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (lv: Level) => {
    if (
      !(await ask({ message: l(`Hapus tingkat "${lv.name}"?`, `Delete level "${lv.name}"?`), danger: true }))
    )
      return;
    try {
      await api(`/dunning-levels/${lv.id}`, { method: "DELETE" });
      load();
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  if (!levels) return <p className="muted">{l("Memuat…", "Loading…")}</p>;
  const err = (k: string) => errors[k] && <small className="error">{errors[k]}</small>;

  return (
    <>
      <p className="muted">
        {l(
          "Placeholder isi surat: {pelanggan}, {perusahaan}, {total}, {daftar_faktur}, {tanggal}, {tingkat}.",
          "Letter placeholders: {pelanggan} (customer), {perusahaan} (company), {total}, {daftar_faktur} (invoice list), {tanggal} (date), {tingkat} (level).",
        )}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="num">{l("Urutan", "Sequence")}</th>
              <th>{l("Nama", "Name")}</th>
              <th className="num">{l("Lewat jatuh tempo (hari)", "Days overdue")}</th>
              <th>{l("Subjek email", "Email subject")}</th>
              <th>{l("Lampiran PDF", "PDF attachment")}</th>
              <th>{l("Aktif", "Active")}</th>
              {writable && <th />}
            </tr>
          </thead>
          <tbody>
            {levels.map((lv) => (
              <tr key={lv.id}>
                <td className="num">{lv.sequence}</td>
                <td>{lv.name}</td>
                <td className="num">{lv.daysOverdue}</td>
                <td>{lv.emailSubject}</td>
                <td>{lv.attachPdf ? l("Ya", "Yes") : l("Tidak", "No")}</td>
                <td>{lv.active ? l("Ya", "Yes") : l("Tidak", "No")}</td>
                {writable && (
                  <td className="actions">
                    <button type="button" className="link" onClick={() => setEdit({ ...lv })}>
                      {l("Ubah", "Edit")}
                    </button>
                    <button type="button" className="link danger" onClick={() => void remove(lv)}>
                      {l("Hapus", "Delete")}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {writable && !edit && (
        <p>
          <button
            type="button"
            onClick={() => setEdit(emptyLevel(Math.max(0, ...levels.map((x) => x.sequence)) + 1))}
          >
            {l("Tambah tingkat", "Add level")}
          </button>
        </p>
      )}
      {edit && (
        <div className="inline-panel">
          <h3>{edit.id ? l("Ubah tingkat", "Edit level") : l("Tingkat baru", "New level")}</h3>
          <div className="fields">
            <label className="field">
              <span>{l("Urutan", "Sequence")}</span>
              <input
                type="number"
                min={1}
                max={20}
                value={edit.sequence}
                aria-invalid={Boolean(errors.sequence)}
                onChange={(e) => setEdit({ ...edit, sequence: Number(e.target.value) })}
              />
              {err("sequence")}
            </label>
            <label className="field">
              <span>{l("Nama", "Name")}</span>
              <input
                value={edit.name}
                maxLength={100}
                aria-invalid={Boolean(errors.name)}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              />
              {err("name")}
            </label>
            <label className="field">
              <span>{l("Lewat jatuh tempo (hari)", "Days overdue")}</span>
              <input
                type="number"
                min={0}
                value={edit.daysOverdue}
                aria-invalid={Boolean(errors.daysOverdue)}
                onChange={(e) => setEdit({ ...edit, daysOverdue: Number(e.target.value) })}
              />
              {err("daysOverdue")}
            </label>
            <label className="field">
              <span>{l("Subjek email", "Email subject")}</span>
              <input
                value={edit.emailSubject}
                maxLength={200}
                aria-invalid={Boolean(errors.emailSubject)}
                onChange={(e) => setEdit({ ...edit, emailSubject: e.target.value })}
              />
              {err("emailSubject")}
            </label>
          </div>
          <label className="field">
            <span>{l("Isi surat / email", "Letter / email body")}</span>
            <textarea
              rows={10}
              value={edit.body}
              maxLength={5000}
              aria-invalid={Boolean(errors.body)}
              onChange={(e) => setEdit({ ...edit, body: e.target.value })}
            />
            {err("body")}
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={edit.attachPdf}
              onChange={(e) => setEdit({ ...edit, attachPdf: e.target.checked })}
            />
            {l("Lampirkan PDF surat teguran", "Attach the PDF letter")}
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={edit.active}
              onChange={(e) => setEdit({ ...edit, active: e.target.checked })}
            />
            {l("Aktif", "Active")}
          </label>
          <div className="cp-right">
            <button type="button" onClick={() => setEdit(null)}>
              {l("Batal", "Cancel")}
            </button>
            <button type="button" className="primary" disabled={busy} aria-busy={busy} onClick={save}>
              {l("Simpan", "Save")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function SettingsTab({ writable }: { writable: boolean }) {
  const { l } = useI18n();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Settings>("/dunning/settings").then(setSettings, (e: unknown) => setError(errorText(e)));
  }, []);

  if (error)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  if (!settings) return <p className="muted">{l("Memuat…", "Loading…")}</p>;

  const save = async () => {
    setBusy(true);
    try {
      setSettings(await api<Settings>("/dunning/settings", { method: "PUT", body: settings }));
      toast.success(l("Pengaturan disimpan", "Settings saved"));
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <label className="check">
        <input
          type="checkbox"
          checked={settings.dunningEnabled}
          disabled={!writable}
          onChange={(e) => setSettings({ ...settings, dunningEnabled: e.target.checked })}
        />
        {l(
          "Kirim surat teguran otomatis setiap hari (perusahaan aktif)",
          "Send dunning letters automatically every day (active company)",
        )}
      </label>
      <label className="field">
        <span>{l("Minimal total tertunggak untuk ditagih", "Minimum overdue total to dun")}</span>
        <input
          inputMode="decimal"
          value={settings.dunningMinAmount}
          disabled={!writable}
          onChange={(e) => setSettings({ ...settings, dunningMinAmount: e.target.value })}
        />
      </label>
      <p className="muted">
        {l(
          "Pelanggan dapat dikecualikan dari dunning di form kontak (panel Kredit & penagihan). Pelanggan perusahaan grup tidak pernah ditagih.",
          "Customers can be excluded from dunning on the contact form (Credit & collections panel). Group companies are never dunned.",
        )}
      </p>
      {writable && (
        <button type="button" className="primary" disabled={busy} aria-busy={busy} onClick={save}>
          {l("Simpan", "Save")}
        </button>
      )}
    </div>
  );
}
