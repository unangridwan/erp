"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppIcon } from "../../../components/app-icon";
import { toast } from "../../../components/feedback";
import { LoadFailed, useLoadError } from "../../../components/load-failed";
import { api } from "../../../lib/api";
import { formatDate } from "../../../lib/format";
import { useI18n } from "../../../lib/i18n";

interface Builtin {
  key: string;
  name: [string, string];
  description: [string, string];
  widgets: number;
  visible: number;
  pinned: boolean;
}
interface Custom {
  id: string;
  name: string;
  description: string | null;
  visibility: "private" | "shared";
  widgets: number;
  ownerName: string | null;
  mine: boolean;
  updatedAt: string;
  pinned: boolean;
}

/** Laporan & Dashboard › Dashboard: bawaan per bidang + buatan sendiri/dibagikan, sematkan ke Beranda. */
export default function DashboardsPage() {
  const { l, locale } = useI18n();
  const router = useRouter();
  const [data, setData] = useState<{ builtin: Builtin[]; custom: Custom[] } | null>(null);
  const [loadError, failLoad] = useLoadError();
  const load = useCallback(() => {
    api<{ builtin: Builtin[]; custom: Custom[] }>("/dashboards").then(setData).catch(failLoad);
  }, [failLoad]);
  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
  useEffect(load, [load]);

  async function togglePin(ref: string) {
    try {
      const pins = await api<string[]>("/me/dashboard-pins");
      const next = pins.includes(ref) ? pins.filter((p) => p !== ref) : [...pins, ref];
      await api("/me/dashboard-pins", { method: "PUT", body: { refs: next } });
      toast.success(
        next.includes(ref)
          ? l("Disematkan di Beranda.", "Pinned to Home.")
          : l("Dilepas dari Beranda.", "Unpinned."),
      );
      load();
    } catch (e) {
      fail(e);
    }
  }

  async function create() {
    try {
      const d = await api<{ id: string }>("/dashboards", {
        method: "POST",
        body: { name: l("Dashboard baru", "New dashboard"), widgets: [] },
      });
      router.push(`/bi/dashboards/${d.id}?edit=1`);
    } catch (e) {
      fail(e);
    }
  }

  const pin = (ref: string, pinned: boolean) => (
    <button
      type="button"
      className={`link pin${pinned ? " on" : ""}`}
      title={pinned ? l("Lepas dari Beranda", "Unpin from Home") : l("Sematkan di Beranda", "Pin to Home")}
      aria-pressed={pinned}
      onClick={() => void togglePin(ref)}
    >
      {pinned ? "★" : "☆"}
    </button>
  );

  return (
    <>
      <header className="toolbar control-panel">
        <div className="cp-left">
          <h1>{l("Dashboard", "Dashboards")}</h1>
          <button className="primary" onClick={() => void create()}>
            {l("Baru", "New")}
          </button>
          <Link className="button" href="/bi/reports">
            {l("Pembuat Laporan", "Report Builder")}
          </Link>
        </div>
      </header>
      {loadError ? (
        <LoadFailed message={loadError} />
      ) : !data ? (
        <p className="muted">{l("Memuat…", "Loading…")}</p>
      ) : (
        <>
          <h2>{l("Dashboard bawaan", "Built-in dashboards")}</h2>
          {data.builtin.length ? (
            <div className="dash-cards">
              {data.builtin.map((d) => (
                <article key={d.key} className="dash-card">
                  <Link href={`/bi/dashboards/${d.key}`} className="dash-card-main">
                    <AppIcon id="bi" size={40} />
                    <span>
                      <strong>{l(...d.name)}</strong>
                      <span className="muted small">{l(...d.description)}</span>
                      {d.visible < d.widgets && (
                        <span className="muted small">
                          {l(
                            `${d.visible} dari ${d.widgets} widget sesuai hak Anda`,
                            `${d.visible} of ${d.widgets} widgets per your access`,
                          )}
                        </span>
                      )}
                    </span>
                  </Link>
                  {pin(`builtin:${d.key}`, d.pinned)}
                </article>
              ))}
            </div>
          ) : (
            <p className="muted">
              {l("Tidak ada dashboard bawaan sesuai hak Anda.", "No built-in dashboards for your access.")}
            </p>
          )}

          <h2>{l("Dashboard saya & dibagikan", "My & shared dashboards")}</h2>
          {data.custom.length ? (
            <div className="dash-cards">
              {data.custom.map((d) => (
                <article key={d.id} className="dash-card">
                  <Link href={`/bi/dashboards/${d.id}`} className="dash-card-main">
                    <span>
                      <strong>{d.name}</strong>
                      {d.description && <span className="muted small">{d.description}</span>}
                      <span className="muted small">
                        {l(`${d.widgets} widget`, `${d.widgets} widgets`)} ·{" "}
                        {d.mine ? l("Milik saya", "Mine") : d.ownerName} ·{" "}
                        {d.visibility === "shared" ? l("Dibagikan", "Shared") : l("Pribadi", "Private")} ·{" "}
                        {formatDate(d.updatedAt, locale)}
                      </span>
                    </span>
                  </Link>
                  {pin(d.id, d.pinned)}
                </article>
              ))}
            </div>
          ) : (
            <p className="muted">
              {l(
                "Belum ada. Buat dashboard baru atau duplikat dashboard bawaan untuk menyesuaikannya.",
                "None yet. Create a dashboard or duplicate a built-in one to customise it.",
              )}
            </p>
          )}
        </>
      )}
    </>
  );
}
