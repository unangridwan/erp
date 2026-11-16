"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import type { DashboardDoc } from "../../lib/bi";
import { useI18n } from "../../lib/i18n";
import { DashboardGrid, resolvePeriod, useWidgetResults, type Widget } from "./dashboard-grid";

/** Satu dashboard yang disematkan: angka KPI-nya (maks. 4) untuk periode bawaan dashboard. */
function Pinned({ pin }: { pin: string }) {
  const { l } = useI18n();
  const builtin = pin.startsWith("builtin:");
  const ref = builtin ? pin.slice(8) : pin;
  const [doc, setDoc] = useState<DashboardDoc | null>(null);
  useEffect(() => {
    api<DashboardDoc>(builtin ? `/dashboards/builtin/${ref}` : `/dashboards/${ref}`).then(setDoc, () =>
      setDoc(null),
    );
  }, [builtin, ref]);
  const period = resolvePeriod(doc?.period ?? "this_month", { from: "", to: "" });
  const body = useMemo(
    () => (doc ? (builtin ? { builtin: ref } : { dashboardId: ref }) : null),
    [doc, builtin, ref],
  );
  const { results } = useWidgetResults(body, period);
  if (!doc) return null;
  const kpis = (doc.widgets as Widget[]).filter((w) => w.type === "kpi" && !w.hidden).slice(0, 4);
  const shown = (kpis.length ? kpis : (doc.widgets as Widget[]).filter((w) => !w.hidden).slice(0, 2)).map(
    (w) => ({
      ...w,
      width: kpis.length ? 1 : 2,
    }),
  );
  const name = typeof doc.name === "string" ? doc.name : l(...doc.name);
  return (
    <section className="home-card home-dashboards">
      <h2>
        <Link href={`/bi/dashboards/${ref}`}>{name}</Link>
      </h2>
      <DashboardGrid widgets={shown} results={results} period={period} />
    </section>
  );
}

/** Dashboard yang disematkan pengguna di Beranda. */
export function PinnedDashboards() {
  const [pins, setPins] = useState<string[]>([]);
  useEffect(() => {
    api<string[]>("/me/dashboard-pins").then(setPins, () => setPins([]));
  }, []);
  if (!pins.length) return null;
  return (
    <>
      {pins.slice(0, 3).map((p) => (
        <Pinned key={p} pin={p} />
      ))}
    </>
  );
}
