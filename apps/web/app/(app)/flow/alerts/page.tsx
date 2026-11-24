"use client";

import type { AlertParamDef, AlertRecipient } from "@erp/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "../../../../components/feedback";
import { api, ApiError } from "../../../../lib/api";
import { formatDate } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";

interface Rule {
  key: string;
  label: [string, string];
  description: [string, string];
  params: AlertParamDef[];
  recipients: AlertRecipient[];
  rolePermission: string;
  link: string;
  active: boolean;
  configured: boolean;
  values: Record<string, number>;
  selected: AlertRecipient[];
  lastRunOn: string | null;
}
interface Preview {
  key: string;
  matches: number;
  recipients: number;
  notified: number;
}

const RECIPIENT: Record<AlertRecipient, [string, string]> = {
  owner: ["Pemegang dokumen / pemilik sasaran", "Document holder / goal owner"],
  manager: ["Manajer departemen / atasan", "Department manager / supervisor"],
  role: ["Pengelola terkait", "Responsible role"],
};

/**
 * Pengaturan peringatan dini: aturan apa yang aktif, ambangnya, dan siapa yang diberi tahu. Diperiksa otomatis tiap
 * hari; tiap orang menerima satu ringkasan per aturan per hari.
 */
export default function AlertSettingsPage() {
  const { l, locale } = useI18n();
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [preview, setPreview] = useState<Record<string, Preview> | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPreview = () =>
    api<Preview[]>("/alerts/preview").then(
      (r) => setPreview(Object.fromEntries(r.map((p) => [p.key, p]))),
      () => setPreview({}),
    );
  useEffect(() => {
    api<Rule[]>("/alerts/rules").then(setRules, (e) =>
      setError(e instanceof ApiError ? e.message : String(e)),
    );
    void loadPreview();
  }, []);

  const update = (key: string, patch: Partial<Rule>) =>
    setRules((rs) => rs?.map((r) => (r.key === key ? { ...r, ...patch } : r)) ?? null);

  async function save(r: Rule) {
    setSaving(r.key);
    try {
      await api(`/alerts/rules/${r.key}`, {
        method: "PUT",
        body: { active: r.active, params: r.values, recipients: r.selected },
      });
      update(r.key, { configured: true });
      toast.success(l(`Aturan "${r.label[0]}" disimpan.`, `Rule "${r.label[1]}" saved.`));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }

  async function runNow() {
    setRunning(true);
    try {
      const res = await api<Preview[]>("/alerts/run", { method: "POST", body: {} });
      const sent = res.reduce((s, r) => s + r.notified, 0);
      toast.success(
        l(
          `${sent} ringkasan peringatan dikirim${res.length ? "" : " (belum ada aturan aktif)"}. Penerima yang sudah menerima hari ini tidak dikirimi lagi.`,
          `${sent} alert digests sent${res.length ? "" : " (no active rules yet)"}. People already alerted today are not sent again.`,
        ),
      );
      void loadPreview();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <header className="toolbar control-panel">
        <div className="cp-left">
          <nav className="breadcrumb">
            <Link href="/flow">{l("Alur Bisnis", "Business Flow")}</Link>
            <span>/</span>
            <h1>{l("Peringatan Dini", "Early Warnings")}</h1>
          </nav>
        </div>
        <div className="cp-right">
          <button
            type="button"
            className="primary"
            disabled={running}
            aria-busy={running}
            onClick={() => void runNow()}
          >
            {l("Jalankan sekarang", "Run now")}
          </button>
        </div>
      </header>
      <p className="muted">
        {l(
          'Aturan aktif diperiksa otomatis setiap hari dengan hak akses orang yang terakhir menyimpannya. Tiap penerima mendapat satu ringkasan per aturan per hari (di lonceng notifikasi, email bila diaktifkan, dan di Pekerjaan Saya). Angka "saat ini" adalah temuan bila aturan dijalankan sekarang.',
          'Active rules are checked automatically every day with the access rights of whoever last saved them. Each recipient gets one digest per rule per day (bell, email when enabled, and My Work). The "now" figure is what the rule would find if run now.',
        )}
      </p>
      {error && <p className="muted">{error}</p>}
      {!rules && !error && <p className="muted">{l("Memuat…", "Loading…")}</p>}
      <div className="alert-rules">
        {rules?.map((r) => {
          const p = preview?.[r.key];
          return (
            <section key={r.key} className={`panel alert-rule${r.active ? " on" : ""}`}>
              <header className="alert-rule-head">
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={r.active}
                    onChange={(e) => update(r.key, { active: e.target.checked })}
                    aria-label={l(`Aktifkan ${r.label[0]}`, `Enable ${r.label[1]}`)}
                  />
                  <strong>{l(...r.label)}</strong>
                </label>
                <span className={`badge ${p && p.matches ? "warn" : "ok"}`}>
                  {p
                    ? l(
                        `Saat ini: ${p.matches} temuan · ${p.recipients} penerima`,
                        `Now: ${p.matches} findings · ${p.recipients} recipients`,
                      )
                    : l("Menghitung…", "Counting…")}
                </span>
              </header>
              <p className="muted small">{l(...r.description)}</p>
              <div className="alert-rule-body">
                {r.params.map((def) => (
                  <label key={def.key} className="field">
                    <span>
                      {l(...def.label)} ({l(...def.unit)})
                    </span>
                    <input
                      className="num"
                      inputMode="numeric"
                      value={String(r.values[def.key] ?? def.default)}
                      onChange={(e) => {
                        const v = Number(e.target.value.replace(/[^\d.]/g, ""));
                        update(r.key, {
                          values: { ...r.values, [def.key]: Number.isFinite(v) ? v : def.default },
                        });
                      }}
                    />
                  </label>
                ))}
                <fieldset className="alert-recipients">
                  <legend>{l("Penerima", "Recipients")}</legend>
                  {r.recipients.map((rc) => (
                    <label key={rc} className="field check">
                      <input
                        type="checkbox"
                        checked={r.selected.includes(rc)}
                        onChange={(e) =>
                          update(r.key, {
                            selected: e.target.checked
                              ? [...r.selected, rc]
                              : r.selected.filter((x) => x !== rc),
                          })
                        }
                      />
                      <span>
                        {l(...RECIPIENT[rc])}
                        {rc === "role" && <code className="muted small"> {r.rolePermission}</code>}
                      </span>
                    </label>
                  ))}
                </fieldset>
              </div>
              <footer className="alert-rule-foot">
                <span className="muted small">
                  {r.lastRunOn
                    ? l(
                        `Terakhir berjalan ${formatDate(r.lastRunOn, locale)}`,
                        `Last run ${formatDate(r.lastRunOn, locale)}`,
                      )
                    : r.configured
                      ? l("Belum pernah berjalan", "Not run yet")
                      : l("Belum diatur", "Not configured")}
                  {" · "}
                  <Link href={r.link}>{l("Buka halaman tindak lanjut →", "Open follow-up page →")}</Link>
                </span>
                <button
                  type="button"
                  disabled={saving === r.key}
                  aria-busy={saving === r.key}
                  onClick={() => void save(r)}
                >
                  {l("Simpan", "Save")}
                </button>
              </footer>
            </section>
          );
        })}
      </div>
    </>
  );
}
