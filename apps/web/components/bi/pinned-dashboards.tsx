"use client";

import { SINGLE_VALUE_VISUALS, type BiDocument, type BiResult, type BiVisual } from "@erp/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { resolvePeriod } from "../../lib/bi-period";
import { useI18n } from "../../lib/i18n";
import { VisualBody } from "./visual";

/** Satu dashboard yang disematkan: kartu/KPI halaman pertama (maks. 4), atau dua visual pertama. */
function Pinned({ pin }: { pin: string }) {
  const { l } = useI18n();
  const builtin = pin.startsWith("builtin:");
  const ref = builtin ? pin.slice(8) : pin;
  const [doc, setDoc] = useState<{ name: string | [string, string]; document: BiDocument } | null>(null);
  const [results, setResults] = useState<Record<string, BiResult>>({});
  useEffect(() => {
    let alive = true;
    api<{ name: string | [string, string]; document: BiDocument }>(
      builtin ? `/dashboards/builtin/${ref}` : `/dashboards/${ref}`,
    )
      .then((d) => {
        if (!alive) return;
        setDoc(d);
        const page = d.document.pages[0];
        if (!page) return;
        const period = resolvePeriod(d.document.period ?? "this_month", { from: "", to: "" });
        return api<{ visuals: BiResult[] }>("/bi/query", {
          method: "POST",
          body: { ...(builtin ? { builtin: ref } : { dashboardId: ref }), pageId: page.id, ...period },
        }).then((r) => alive && setResults(Object.fromEntries(r.visuals.map((v) => [v.id, v]))));
      })
      .catch(() => alive && setDoc(null));
    return () => {
      alive = false;
    };
  }, [builtin, ref]);
  if (!doc) return null;
  const visuals = (doc.document.pages[0]?.visuals ?? []).filter(
    (v) => v.type !== "text" && !results[v.id]?.hidden,
  );
  const cards = visuals.filter((v) => SINGLE_VALUE_VISUALS.includes(v.type)).slice(0, 4);
  const shown: BiVisual[] = cards.length ? cards : visuals.slice(0, 2);
  const name = typeof doc.name === "string" ? doc.name : l(...doc.name);
  return (
    <section className="home-card home-dashboards">
      <h2>
        <Link href={`/bi/dashboards/${ref}`}>{name}</Link>
      </h2>
      <div className={`bi-pinned${cards.length ? " cards" : ""}`}>
        {shown.map((v) => (
          <section key={v.id} className={`bi-visual type-${v.type}`}>
            <header>
              <h3>{v.title}</h3>
            </header>
            <div className="bi-visual-body">
              <VisualBody visual={v} result={results[v.id]} />
            </div>
          </section>
        ))}
      </div>
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
