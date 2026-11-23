"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { localDay, money } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { can } from "../lib/resources";
import type { Me } from "../lib/api";

interface Kpis {
  income: string;
  netProfit: string;
  receivable: string;
  receivableOverdue: string;
  payable: string;
  payableOverdue: string;
  cash: string;
}
type Aged = { totals: { current: string; total: string } };

/**
 * Angka bisnis utama di beranda (bulan berjalan, perusahaan aktif): pendapatan, laba bersih, piutang & utang (yang
 * jatuh tempo), saldo kas & bank. Hanya untuk pengguna dengan hak baca akuntansi; tiap kartu menautkan laporannya.
 */
export function HomeKpis({ me }: { me: Me }) {
  const { l, locale } = useI18n();
  const allowed = can(me.permissions, "accounting.read");
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!allowed) return;
    const to = localDay();
    const from = `${to.slice(0, 8)}01`;
    Promise.all([
      api<{ income: { total: string }; netProfit: string }>(
        `/reports/profit-loss?dateFrom=${from}&dateTo=${to}`,
      ),
      api<Aged>(`/reports/aged?type=receivable&dateTo=${to}`),
      api<Aged>(`/reports/aged?type=payable&dateTo=${to}`),
      api<{ cashClosing: string }>(`/reports/cash-flow?dateFrom=${from}&dateTo=${to}`),
    ]).then(
      ([pl, ar, ap, cf]) =>
        setKpis({
          income: pl.income.total,
          netProfit: pl.netProfit,
          receivable: ar.totals.total,
          receivableOverdue: String(Number(ar.totals.total) - Number(ar.totals.current)),
          payable: ap.totals.total,
          payableOverdue: String(Number(ap.totals.total) - Number(ap.totals.current)),
          cash: cf.cashClosing,
        }),
      () => setFailed(true),
    );
  }, [allowed]);
  if (!allowed) return null;
  if (failed)
    return (
      <p className="muted small">
        {l(
          "Ringkasan keuangan tidak dapat dimuat saat ini.",
          "The financial summary could not be loaded right now.",
        )}
      </p>
    );
  const rp = (v: string | undefined) => (v === undefined ? "…" : `Rp ${money(v, locale, 0)}`);
  const month = new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", {
    month: "long",
    year: "numeric",
  }).format(new Date());
  const cards: { label: string; value: string; note?: string; href: string; warn?: boolean }[] = [
    {
      label: l(`Pendapatan ${month}`, `Revenue ${month}`),
      value: rp(kpis?.income),
      href: "/accounting/reports",
    },
    {
      label: l(`Laba bersih ${month}`, `Net profit ${month}`),
      value: rp(kpis?.netProfit),
      href: "/accounting/reports",
      warn: !!kpis && Number(kpis.netProfit) < 0,
    },
    {
      label: l("Piutang usaha", "Receivables"),
      value: rp(kpis?.receivable),
      note:
        kpis && Number(kpis.receivableOverdue) > 0
          ? l(`Jatuh tempo: ${rp(kpis.receivableOverdue)}`, `Overdue: ${rp(kpis.receivableOverdue)}`)
          : undefined,
      href: "/accounting/reports?tab=aged",
      warn: !!kpis && Number(kpis.receivableOverdue) > 0,
    },
    {
      label: l("Utang usaha", "Payables"),
      value: rp(kpis?.payable),
      note:
        kpis && Number(kpis.payableOverdue) > 0
          ? l(`Jatuh tempo: ${rp(kpis.payableOverdue)}`, `Overdue: ${rp(kpis.payableOverdue)}`)
          : undefined,
      href: "/accounting/reports?tab=aged",
      warn: !!kpis && Number(kpis.payableOverdue) > 0,
    },
    {
      label: l("Kas & bank", "Cash & bank"),
      value: rp(kpis?.cash),
      href: "/accounting/reports?tab=cash-flow",
    },
  ];
  return (
    <section className="home-kpis" aria-label={l("Ringkasan keuangan", "Financial summary")}>
      {cards.map((c) => (
        <Link key={c.label} href={c.href} className="home-kpi">
          <span className="muted small">{c.label}</span>
          <strong className={c.warn ? "kpi-warn" : undefined}>{c.value}</strong>
          {c.note && <span className="small overdue">{c.note}</span>}
        </Link>
      ))}
    </section>
  );
}
