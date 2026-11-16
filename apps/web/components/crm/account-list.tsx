"use client";

import { ACCOUNT_RATING_LABEL } from "@erp/shared";
import Link from "next/link";
import { useMemo } from "react";
import { money } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { can } from "../../lib/resources";
import { truncatedNote, useListData } from "../../lib/use-list-data";
import { DataTable, type DataColumn } from "../data-table";
import { useMe } from "../me-context";

interface AccountRow {
  id: string;
  name: string;
  parentId: string | null;
  parentName: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  industry: string | null;
  jobTitle: string | null;
  accountRating: string | null;
  doNotContact: boolean;
  salespersonName: string | null;
  openCount: number;
  pipeline: string;
  contacts: number;
}

/** Daftar akun (perusahaan pelanggan) atau kontak (perorangan) dengan ringkasan pipeline; klik = tampilan 360°. */
export function AccountList({ kind }: { kind: "company" | "person" }) {
  const me = useMe();
  const { l, locale } = useI18n();
  const params = useMemo(() => ({ kind }), [kind]);
  const list = useListData<AccountRow>("/crm/accounts", params);
  const company = kind === "company";

  const columns = useMemo<DataColumn<AccountRow>[]>(() => {
    const rating = (v: string | null) => (v && ACCOUNT_RATING_LABEL[v] ? l(...ACCOUNT_RATING_LABEL[v]!) : "");
    const cols: (DataColumn<AccountRow> | null)[] = [
      {
        key: "name",
        label: company ? l("Akun", "Account") : l("Kontak", "Contact"),
        value: (x) => x.name,
        render: (x) => (
          <>
            <Link href={`/crm/accounts/${x.id}`}>{x.name}</Link>
            {x.doNotContact && (
              <span className="badge state-cancel">{l("Jangan dihubungi", "Do not contact")}</span>
            )}
          </>
        ),
      },
      company
        ? { key: "industry", label: l("Industri", "Industry"), type: "enum", value: (x) => x.industry }
        : { key: "jobTitle", label: l("Jabatan", "Job title"), value: (x) => x.jobTitle },
      company
        ? null
        : {
            key: "parent",
            label: l("Akun", "Account"),
            type: "enum",
            value: (x) => x.parentName,
            render: (x) =>
              x.parentId ? <Link href={`/crm/accounts/${x.parentId}`}>{x.parentName}</Link> : <>—</>,
          },
      { key: "city", label: l("Kota", "City"), type: "enum", value: (x) => x.city },
      { key: "email", label: l("Email", "Email"), value: (x) => x.email },
      { key: "phone", label: l("Telepon", "Phone"), value: (x) => x.phone },
      company
        ? {
            key: "rating",
            label: l("Peringkat", "Rating"),
            type: "enum",
            value: (x) => x.accountRating,
            optionLabel: (v) => rating(v),
            text: (x) => rating(x.accountRating),
          }
        : null,
      company
        ? {
            key: "user",
            label: l("Penanggung jawab", "Owner"),
            type: "enum",
            value: (x) => x.salespersonName,
          }
        : null,
      company
        ? {
            key: "contacts",
            label: l("Kontak", "Contacts"),
            type: "number",
            className: "num",
            value: (x) => x.contacts,
          }
        : null,
      {
        key: "openCount",
        label: l("Peluang terbuka", "Open opportunities"),
        type: "number",
        className: "num",
        value: (x) => x.openCount,
      },
      {
        key: "pipeline",
        label: l("Nilai pipeline", "Pipeline value"),
        type: "number",
        className: "num",
        value: (x) => Number(x.pipeline),
        text: (x) => money(x.pipeline, locale),
      },
    ];
    return cols.filter((c): c is DataColumn<AccountRow> => c !== null);
  }, [l, locale, company]);

  return (
    <>
      <header className="toolbar">
        <h1>{company ? l("Akun", "Accounts") : l("Kontak", "Contacts")}</h1>
        {can(me.permissions, "partner.write") && (
          <Link className="button primary" href="/partners/new">
            {l("Baru", "New")}
          </Link>
        )}
      </header>
      {list.error && <p className="error">{list.error}</p>}
      {!list.loading || list.rows.length ? (
        <DataTable
          rows={list.rows}
          columns={columns}
          storageKey={company ? "crm-accounts" : "crm-contacts"}
          rowKey={(x) => x.id}
          rowHref={(x) => `/crm/accounts/${x.id}`}
          defaultSort={{ key: "name", dir: "asc" }}
          note={truncatedNote(list, l)}
          searchPlaceholder={l("Cari nama, kota, email…", "Search name, city, email…")}
          empty={
            company
              ? l(
                  "Belum ada akun. Akun dibuat saat lead dikonversi atau dari menu Kontak.",
                  "No accounts yet.",
                )
              : l("Belum ada kontak.", "No contacts yet.")
          }
        />
      ) : (
        <p className="muted">{l("Memuat…", "Loading…")}</p>
      )}
    </>
  );
}
