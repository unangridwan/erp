"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { money, formatDate } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { can, MOVE_KINDS, MOVE_TYPE_LABEL, PAYMENT_STATE_LABEL, type MoveKind } from "../../lib/resources";
import { truncatedNote, useListData } from "../../lib/use-list-data";
import { DataTable, type DataColumn } from "../data-table";
import { useMe } from "../me-context";
import { PaymentBadge, StateBadge, TypeLabel } from "./badges";

interface Move {
  id: string;
  name: string | null;
  moveType: string;
  state: string;
  date: string;
  dueDate: string | null;
  ref: string | null;
  partnerName: string | null;
  currencyCode: string;
  amountTotal: string;
  amountResidual: string;
  paymentState: string;
  autoPost?: boolean;
}

/** Jurnal / faktur / tagihan: dimuat sekali per jenis lalu cari, filter, sort & paginasi di browser. */
export function MoveList({ kind }: { kind: MoveKind }) {
  const me = useMe();
  const { l, tx, locale } = useI18n();
  const def = MOVE_KINDS[kind];
  const isEntry = kind === "entries";
  const [search, setSearch] = useState("");
  const paths = useMemo(() => def.types.map((type) => `/moves?type=${type}`), [def]);
  const list = useListData<Move>(paths, {}, search);

  const columns = useMemo(() => {
    const stateLabel = (s: string) => (s === "posted" ? l("Diposting", "Posted") : l("Draft", "Draft"));
    const cols: (DataColumn<Move> | false)[] = [
      {
        key: "name",
        label: l("Nomor", "Number"),
        value: (m) => m.name ?? "",
        text: (m) => m.name ?? l("Draft", "Draft"),
        render: (m) => (
          <>
            <Link href={`/accounting/moves/${m.id}`}>{m.name ?? l("Draft", "Draft")}</Link>
            {m.moveType.endsWith("refund") && (
              <small className="muted">
                {" "}
                · <TypeLabel type={m.moveType} />
              </small>
            )}
          </>
        ),
      },
      def.types.length > 1 && {
        key: "moveType",
        label: l("Jenis", "Type"),
        type: "enum",
        value: (m) => m.moveType,
        text: (m) => (MOVE_TYPE_LABEL[m.moveType] ? tx(MOVE_TYPE_LABEL[m.moveType]!) : m.moveType),
      },
      {
        key: "date",
        label: l("Tanggal", "Date"),
        type: "date",
        value: (m) => m.date,
        text: (m) => formatDate(m.date, locale),
      },
      !isEntry && { key: "partner", label: l("Partner", "Partner"), value: (m) => m.partnerName },
      { key: "ref", label: l("Referensi", "Reference"), value: (m) => m.ref },
      !isEntry && {
        key: "dueDate",
        label: l("Jatuh tempo", "Due"),
        type: "date",
        value: (m) => m.dueDate,
        text: (m) => formatDate(m.dueDate, locale),
      },
      {
        key: "amountTotal",
        label: l("Total", "Total"),
        type: "number",
        className: "num",
        value: (m) => Number(m.amountTotal),
        text: (m) => `${isEntry ? "" : `${m.currencyCode} `}${money(m.amountTotal, locale)}`,
      },
      !isEntry && {
        key: "amountResidual",
        label: l("Sisa", "Due amount"),
        type: "number",
        className: "num",
        value: (m) => (m.state === "posted" ? Number(m.amountResidual) : null),
        text: (m) => (m.state === "posted" ? money(m.amountResidual, locale) : ""),
      },
      {
        key: "state",
        label: l("Status", "Status"),
        type: "enum",
        value: (m) => m.state,
        text: (m) => stateLabel(m.state),
        render: (m) => (
          <>
            <StateBadge state={m.state} />{" "}
            {m.state === "draft" && m.autoPost && (
              <span
                className="muted small"
                title={l("Diposting otomatis pada tanggalnya", "Posted automatically on its date")}
              >
                {l("terjadwal", "scheduled")}
              </span>
            )}
            {!isEntry && m.state === "posted" && <PaymentBadge state={m.paymentState} />}
          </>
        ),
      },
      !isEntry && {
        key: "paymentState",
        label: l("Pembayaran", "Payment"),
        type: "enum",
        hidden: true,
        value: (m) => (m.state === "posted" ? m.paymentState : ""),
        text: (m) =>
          m.state === "posted" && PAYMENT_STATE_LABEL[m.paymentState]
            ? tx(PAYMENT_STATE_LABEL[m.paymentState]!)
            : "",
      },
    ];
    return cols.filter((c): c is DataColumn<Move> => !!c);
  }, [def, isEntry, l, tx, locale]);

  return (
    <>
      <header className="toolbar">
        <h1>{tx(def.title)}</h1>
        {can(me.permissions, "accounting.write") && (
          <Link className="button primary" href={`/accounting/moves/new?type=${def.newType}`}>
            {l("Baru", "New")}
          </Link>
        )}
      </header>
      {list.error && (
        <p className="error" role="alert">
          {list.error}
        </p>
      )}
      {!list.loading || list.rows.length ? (
        <DataTable
          customModel="account_move"
          rows={list.rows}
          columns={columns}
          storageKey={`moves.${kind}`}
          rowKey={(m) => m.id}
          rowHref={(m) => `/accounting/moves/${m.id}`}
          defaultSort={{ key: "date", dir: "desc" }}
          note={truncatedNote(list, l)}
          onSearch={setSearch}
          searchPlaceholder={l("Cari nomor, referensi, partner…", "Search number, reference, partner…")}
          empty={l("Belum ada dokumen.", "No documents yet.")}
        />
      ) : (
        <p className="muted">{l("Memuat…", "Loading…")}</p>
      )}
    </>
  );
}
