"use client";

import { RECURRING_FREQUENCY_LABEL, type RecurringFrequency } from "@erp/shared";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  useOptions,
  type AccountOption,
  type JournalOption,
} from "../../../../components/accounting/use-options";
import { DataTable, type DataColumn } from "../../../../components/data-table";
import { ask, toast } from "../../../../components/feedback";
import { useMe } from "../../../../components/me-context";
import { api, ApiError } from "../../../../lib/api";
import { formatDate, money, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

interface Line {
  accountId: string;
  name: string | null;
  debit: string;
  credit: string;
}
interface Template {
  id: string;
  name: string;
  journalId: string;
  journalName?: string | null;
  ref: string | null;
  narration: string | null;
  lines: Line[];
  frequency: RecurringFrequency;
  interval: number;
  startDate: string;
  nextDate: string | null;
  endDate: string | null;
  remainingCount: number | null;
  autoPost: boolean;
  autoReverse: boolean;
  active: boolean;
  lastError: string | null;
  generated?: number;
}
interface Detail extends Template {
  entries: { id: string; name: string | null; date: string; state: string; autoPost: boolean }[];
  upcoming: string[];
}

type Form = Omit<Template, "id" | "nextDate" | "lastError" | "remainingCount" | "interval"> & {
  id?: string;
  interval: string;
  remainingCount: string;
};

const emptyForm = (journalId: string): Form => ({
  name: "",
  journalId,
  ref: "",
  narration: "",
  frequency: "monthly",
  interval: "1",
  startDate: today(),
  endDate: "",
  remainingCount: "",
  autoPost: false,
  autoReverse: false,
  active: true,
  lines: [
    { accountId: "", name: "", debit: "", credit: "" },
    { accountId: "", name: "", debit: "", credit: "" },
  ],
});

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Akuntansi › Jurnal Berulang: template jurnal (sewa, alokasi, akrual) yang dibuat otomatis sesuai jadwal. */
export default function RecurringPage() {
  return (
    <Suspense>
      <Recurring />
    </Suspense>
  );
}

function Recurring() {
  const { l, locale } = useI18n();
  const me = useMe();
  const router = useRouter();
  const params = useSearchParams();
  const openId = params.get("id");
  const writable = can(me.permissions, "accounting.write");
  const [rows, setRows] = useState<Template[] | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const accounts = useOptions<AccountOption>("/accounts");
  const journals = useOptions<JournalOption>("/journals");
  const generalJournal = journals.find((j) => j.journalType === "general")?.id ?? "";

  const load = useCallback(() => {
    api<Template[]>("/recurring-entries").then(setRows, (e: unknown) => toast.error(errorText(e)));
  }, []);
  useEffect(load, [load]);

  const open = useCallback(async (id: string) => {
    const d = await api<Detail>(`/recurring-entries/${id}`);
    setDetail(d);
    setErrors({});
    setForm({
      ...d,
      interval: String(d.interval),
      remainingCount: d.remainingCount === null ? "" : String(d.remainingCount),
      endDate: d.endDate ?? "",
      ref: d.ref ?? "",
      narration: d.narration ?? "",
      lines: d.lines.map((x) => ({
        ...x,
        name: x.name ?? "",
        debit: Number(x.debit) ? String(Number(x.debit)) : "",
        credit: Number(x.credit) ? String(Number(x.credit)) : "",
      })),
    });
  }, []);
  useEffect(() => {
    if (openId) open(openId).catch((e: unknown) => toast.error(errorText(e)));
  }, [openId, open]);

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setErrors({});
    try {
      const body = {
        name: form.name,
        journalId: form.journalId || generalJournal,
        ref: form.ref || null,
        narration: form.narration || null,
        frequency: form.frequency,
        interval: Number(form.interval || 1),
        startDate: form.startDate,
        endDate: form.endDate || null,
        remainingCount: form.remainingCount ? Number(form.remainingCount) : null,
        autoPost: form.autoPost,
        autoReverse: form.autoReverse,
        active: form.active,
        lines: form.lines
          .filter((x) => x.accountId)
          .map((x) => ({
            accountId: x.accountId,
            name: x.name || null,
            debit: x.debit || "0",
            credit: x.credit || "0",
          })),
      };
      const saved = await api<Template>(form.id ? `/recurring-entries/${form.id}` : "/recurring-entries", {
        method: form.id ? "PUT" : "POST",
        body,
      });
      toast.success(l("Jurnal berulang disimpan", "Recurring entry saved"));
      load();
      await open(saved.id);
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    if (!form?.id) return;
    setBusy(true);
    try {
      const res = await api<{ created: { error?: string }[] }>(`/recurring-entries/${form.id}/generate`, {
        method: "POST",
        body: {},
      });
      const failed = res.created.find((c) => c.error);
      if (!res.created.length) toast.info(l("Belum ada yang jatuh tempo.", "Nothing is due yet."));
      else if (failed) toast.error(failed.error!);
      else toast.success(l(`${res.created.length} entri dibuat`, `${res.created.length} entries created`));
      load();
      await open(form.id);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!form?.id) return;
    if (!(await ask({ message: l(`Hapus "${form.name}"?`, `Delete "${form.name}"?`), danger: true }))) return;
    try {
      await api(`/recurring-entries/${form.id}`, { method: "DELETE" });
      setForm(null);
      setDetail(null);
      router.replace("/accounting/recurring");
      load();
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const columns = useMemo<DataColumn<Template>[]>(
    () => [
      {
        key: "name",
        label: l("Nama", "Name"),
        value: (r) => r.name,
        render: (r) => (
          <button type="button" className="link" onClick={() => void open(r.id)}>
            {r.name}
          </button>
        ),
      },
      {
        key: "frequency",
        label: l("Frekuensi", "Frequency"),
        type: "enum",
        value: (r) => r.frequency,
        text: (r) =>
          `${r.interval > 1 ? `${r.interval}× ` : ""}${l(...RECURRING_FREQUENCY_LABEL[r.frequency])}`,
        optionLabel: (v) => l(...RECURRING_FREQUENCY_LABEL[v as RecurringFrequency]),
      },
      {
        key: "amount",
        label: l("Nilai", "Amount"),
        type: "number",
        className: "num",
        value: (r) => r.lines.reduce((t, x) => t + Number(x.debit), 0),
        render: (r) =>
          money(
            r.lines.reduce((t, x) => t + Number(x.debit), 0),
            locale,
          ),
      },
      {
        key: "nextDate",
        label: l("Berikutnya", "Next"),
        type: "date",
        value: (r) => r.nextDate,
        render: (r) => (r.nextDate ? formatDate(r.nextDate, locale) : "—"),
      },
      {
        key: "mode",
        label: l("Mode", "Mode"),
        type: "enum",
        value: (r) => (r.autoPost ? "post" : "draft"),
        text: (r) => (r.autoPost ? l("Posting otomatis", "Auto-post") : l("Draft", "Draft")),
        optionLabel: (v) => (v === "post" ? l("Posting otomatis", "Auto-post") : l("Draft", "Draft")),
      },
      {
        key: "active",
        label: l("Status", "Status"),
        type: "enum",
        value: (r) => (r.active ? "active" : "inactive"),
        text: (r) => (r.active ? l("Aktif", "Active") : l("Selesai/nonaktif", "Done/inactive")),
        optionLabel: (v) => (v === "active" ? l("Aktif", "Active") : l("Selesai/nonaktif", "Done/inactive")),
        render: (r) => (
          <>
            {r.active ? l("Aktif", "Active") : l("Selesai/nonaktif", "Done/inactive")}
            {r.lastError && <div className="error small">{r.lastError}</div>}
          </>
        ),
      },
      { key: "generated", label: l("Dibuat", "Generated"), type: "number", value: (r) => r.generated ?? 0 },
    ],
    [l, locale, open],
  );

  const setLine = (i: number, patch: Partial<Line>) =>
    setForm((f) => (f ? { ...f, lines: f.lines.map((x, j) => (j === i ? { ...x, ...patch } : x)) } : f));
  const totals = form
    ? {
        debit: form.lines.reduce((t, x) => t + Number(x.debit || 0), 0),
        credit: form.lines.reduce((t, x) => t + Number(x.credit || 0), 0),
      }
    : null;
  const err = (k: string) => errors[k] && <small className="error">{errors[k]}</small>;

  return (
    <div className="stack-wide">
      <div className="panel">
        <header className="toolbar">
          <h1>{l("Jurnal Berulang", "Recurring Entries")}</h1>
          {writable && (
            <button
              type="button"
              className="primary"
              onClick={() => {
                setDetail(null);
                setErrors({});
                setForm(emptyForm(generalJournal));
              }}
            >
              {l("Baru", "New")}
            </button>
          )}
        </header>
        <p className="muted">
          {l(
            "Template jurnal yang dibuat otomatis sesuai jadwal (sewa, alokasi biaya, akrual). Pilih per template: posting otomatis atau dibuat sebagai draft untuk ditinjau. Opsi balik otomatis membuat pembalik pada hari berikutnya (untuk akrual akhir bulan).",
            "Journal templates generated on schedule (rent, cost allocation, accruals). Per template: auto-post or create drafts for review. Auto-reverse creates a reversal the next day (for month-end accruals).",
          )}
        </p>
        {!rows ? (
          <p className="muted">{l("Memuat…", "Loading…")}</p>
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            storageKey="recurring-entries"
            rowKey={(r) => r.id}
            defaultSort={{ key: "nextDate", dir: "asc" }}
            empty={l("Belum ada jurnal berulang.", "No recurring entries yet.")}
          />
        )}
      </div>

      {form && (
        <div className="panel">
          <header className="toolbar">
            <h2>{form.id ? form.name : l("Jurnal berulang baru", "New recurring entry")}</h2>
            {form.id && writable && form.active && (
              <button type="button" disabled={busy} onClick={generate}>
                {l("Buat yang jatuh tempo sekarang", "Generate due entries now")}
              </button>
            )}
            {form.id && writable && detail && detail.entries.length === 0 && (
              <button type="button" className="danger" onClick={remove}>
                {l("Hapus", "Delete")}
              </button>
            )}
          </header>
          {detail?.lastError && <p className="error">{detail.lastError}</p>}
          <fieldset className="fields" disabled={!writable}>
            <label className="field">
              <span>{l("Nama *", "Name *")}</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              {err("name")}
            </label>
            <label className="field">
              <span>{l("Jurnal", "Journal")}</span>
              <select
                value={form.journalId || generalJournal}
                onChange={(e) => setForm({ ...form, journalId: e.target.value })}
              >
                {journals.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.code} — {j.name}
                  </option>
                ))}
              </select>
              {err("journalId")}
            </label>
            <label className="field">
              <span>{l("Frekuensi", "Frequency")}</span>
              <select
                value={form.frequency}
                onChange={(e) => setForm({ ...form, frequency: e.target.value as RecurringFrequency })}
              >
                {(Object.keys(RECURRING_FREQUENCY_LABEL) as RecurringFrequency[]).map((f) => (
                  <option key={f} value={f}>
                    {l(...RECURRING_FREQUENCY_LABEL[f])}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{l("Setiap (kali periode)", "Every (periods)")}</span>
              <input
                type="number"
                min={1}
                max={12}
                value={form.interval}
                onChange={(e) => setForm({ ...form, interval: e.target.value })}
              />
              {err("interval")}
            </label>
            <label className="field">
              <span>{l("Tanggal mulai *", "Start date *")}</span>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              />
              <small className="muted">
                {l("Tanggal akhir bulan tetap akhir bulan.", "Month-end dates stay at month end.")}
              </small>
            </label>
            <label className="field">
              <span>{l("Berakhir pada", "Ends on")}</span>
              <input
                type="date"
                value={form.endDate ?? ""}
                min={form.startDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              />
              {err("endDate")}
            </label>
            <label className="field">
              <span>{l("Atau sejumlah (kali)", "Or a number of times")}</span>
              <input
                type="number"
                min={1}
                value={form.remainingCount}
                onChange={(e) => setForm({ ...form, remainingCount: e.target.value })}
              />
            </label>
            <label className="field">
              <span>{l("Referensi", "Reference")}</span>
              <input value={form.ref ?? ""} onChange={(e) => setForm({ ...form, ref: e.target.value })} />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={form.autoPost}
                onChange={(e) => setForm({ ...form, autoPost: e.target.checked })}
              />
              {l(
                "Posting otomatis (tidak dicentang = dibuat sebagai draft)",
                "Auto-post (unchecked = create drafts)",
              )}
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={form.autoReverse}
                onChange={(e) => setForm({ ...form, autoReverse: e.target.checked })}
              />
              {l("Balik otomatis hari berikutnya (akrual)", "Auto-reverse the next day (accrual)")}
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              {l("Aktif", "Active")}
            </label>
          </fieldset>

          <h3>{l("Baris jurnal", "Journal lines")}</h3>
          {err("lines")}
          <div className="table-wrap">
            <div className="table-scroll">
              <table className="lines">
                <thead>
                  <tr>
                    <th>{l("Akun", "Account")}</th>
                    <th>{l("Keterangan", "Label")}</th>
                    <th className="num">{l("Debit", "Debit")}</th>
                    <th className="num">{l("Kredit", "Credit")}</th>
                    {writable && <th />}
                  </tr>
                </thead>
                <tbody>
                  {form.lines.map((x, i) => (
                    <tr key={i}>
                      <td>
                        <select
                          disabled={!writable}
                          value={x.accountId}
                          aria-label={l("Akun", "Account")}
                          onChange={(e) => setLine(i, { accountId: e.target.value })}
                        >
                          <option value="">—</option>
                          {accounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.code} {a.name}
                            </option>
                          ))}
                        </select>
                        {err(`lines.${i}.accountId`)}
                      </td>
                      <td>
                        <input
                          disabled={!writable}
                          value={x.name ?? ""}
                          aria-label={l("Keterangan", "Label")}
                          onChange={(e) => setLine(i, { name: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          disabled={!writable}
                          className="num"
                          inputMode="decimal"
                          aria-label={l("Debit", "Debit")}
                          value={x.debit}
                          onChange={(e) =>
                            setLine(i, { debit: e.target.value, credit: e.target.value ? "" : x.credit })
                          }
                        />
                        {err(`lines.${i}.debit`)}
                      </td>
                      <td>
                        <input
                          disabled={!writable}
                          className="num"
                          inputMode="decimal"
                          aria-label={l("Kredit", "Credit")}
                          value={x.credit}
                          onChange={(e) =>
                            setLine(i, { credit: e.target.value, debit: e.target.value ? "" : x.debit })
                          }
                        />
                      </td>
                      {writable && (
                        <td>
                          <button
                            type="button"
                            className="link"
                            disabled={form.lines.length <= 2}
                            aria-label={l("Hapus baris", "Remove line")}
                            onClick={() => setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) })}
                          >
                            ✕
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>
                      {totals && Math.round((totals.debit - totals.credit) * 100) !== 0 && (
                        <span className="error">
                          {l("Debit dan kredit belum seimbang", "Debit and credit do not balance")}
                        </span>
                      )}
                    </td>
                    <td className="num">{totals && money(totals.debit, locale)}</td>
                    <td className="num">{totals && money(totals.credit, locale)}</td>
                    {writable && <td />}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          {writable && (
            <button
              type="button"
              className="link"
              onClick={() =>
                setForm({
                  ...form,
                  lines: [...form.lines, { accountId: "", name: "", debit: "", credit: "" }],
                })
              }
            >
              + {l("Tambah baris", "Add line")}
            </button>
          )}
          {writable && (
            <div className="cp-right">
              <button
                type="button"
                onClick={() => {
                  setForm(null);
                  setDetail(null);
                  if (openId) router.replace("/accounting/recurring");
                }}
              >
                {l("Tutup", "Close")}
              </button>
              <button type="button" className="primary" disabled={busy} aria-busy={busy} onClick={save}>
                {l("Simpan", "Save")}
              </button>
            </div>
          )}

          {detail && (
            <div className="recurring-history">
              {detail.upcoming.length > 0 && (
                <p className="muted">
                  {l("Jadwal berikutnya:", "Upcoming:")}{" "}
                  {detail.upcoming.map((d) => formatDate(d, locale)).join(", ")}
                </p>
              )}
              <h3>{l("Entri yang sudah dibuat", "Generated entries")}</h3>
              {detail.entries.length === 0 ? (
                <p className="muted">{l("Belum ada.", "None yet.")}</p>
              ) : (
                <ul>
                  {detail.entries.map((e) => (
                    <li key={e.id}>
                      <Link href={`/accounting/moves/${e.id}`}>{e.name ?? l("Draft", "Draft")}</Link> ·{" "}
                      {formatDate(e.date, locale)} ·{" "}
                      {e.state === "posted" ? l("Diposting", "Posted") : l("Draft", "Draft")}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
