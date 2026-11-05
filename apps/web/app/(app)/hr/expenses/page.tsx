"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DataTable, type DataColumn } from "../../../../components/data-table";
import { ExpenseClaimForm } from "../../../../components/hr/expense-form";
import { useMe } from "../../../../components/me-context";
import { api } from "../../../../lib/api";
import { formatDate, money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can, EXPENSE_STATE_LABEL } from "../../../../lib/resources";
import { useListData } from "../../../../lib/use-list-data";

interface Claim {
  id: string;
  name: string;
  employeeName: string;
  date: string;
  description: string | null;
  state: string;
  payMethod: string;
  total: string;
}

/** Klaim biaya karyawan: semua klaim dimuat sekali (cari/filter status di browser), buat klaim untuk karyawan (HR). */
export default function ExpensesPage() {
  const { l, tx, locale } = useI18n();
  const me = useMe();
  const list = useListData<Claim>("/expense-claims");
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    api<{ id: string; name: string }[]>("/me/expense-categories").then(setCategories, () =>
      setCategories([]),
    );
  }, []);

  const columns = useMemo<DataColumn<Claim>[]>(
    () => [
      {
        key: "name",
        label: l("Nomor", "Number"),
        value: (c) => c.name,
        render: (c) => <Link href={`/hr/expenses/${c.id}`}>{c.name}</Link>,
      },
      { key: "employee", label: l("Karyawan", "Employee"), value: (c) => c.employeeName },
      {
        key: "date",
        label: l("Tanggal", "Date"),
        type: "date",
        value: (c) => c.date,
        text: (c) => formatDate(c.date, locale),
      },
      { key: "description", label: l("Keperluan", "Purpose"), value: (c) => c.description },
      {
        key: "payMethod",
        label: l("Dibayar", "Paid"),
        type: "enum",
        value: (c) => c.payMethod,
        text: (c) => (c.payMethod === "cash" ? l("Kas/bank", "Cash/bank") : l("Slip gaji", "Payslip")),
      },
      {
        key: "total",
        label: l("Jumlah", "Amount"),
        type: "number",
        className: "num",
        value: (c) => Number(c.total),
        text: (c) => money(c.total, locale),
      },
      {
        key: "state",
        label: l("Status", "Status"),
        type: "enum",
        value: (c) => c.state,
        optionLabel: (v) => (EXPENSE_STATE_LABEL[v] ? tx(EXPENSE_STATE_LABEL[v]!) : v),
        text: (c) => (EXPENSE_STATE_LABEL[c.state] ? tx(EXPENSE_STATE_LABEL[c.state]!) : c.state),
        render: (c) => (
          <span className={`badge state-${c.state === "paid" ? "sale" : c.state}`}>
            {EXPENSE_STATE_LABEL[c.state] ? tx(EXPENSE_STATE_LABEL[c.state]!) : c.state}
          </span>
        ),
      },
    ],
    [l, tx, locale],
  );

  return (
    <div className="panel">
      <header className="toolbar">
        <h1>{l("Klaim Biaya", "Expense Claims")}</h1>
        {can(me.permissions, "hr.write") && !open && (
          <button type="button" className="primary" onClick={() => setOpen(true)}>
            {l("Klaim baru", "New claim")}
          </button>
        )}
        <Link href="/expense-categories">{l("Kategori klaim", "Expense categories")}</Link>
      </header>
      {list.error && <p className="error">{list.error}</p>}
      {open && (
        <ExpenseClaimForm
          categories={categories}
          chooseEmployee
          onSaved={() => {
            setOpen(false);
            list.reload();
          }}
          onCancel={() => setOpen(false)}
        />
      )}
      <DataTable
        rows={list.rows}
        columns={columns}
        storageKey="expense-claims"
        rowKey={(c) => c.id}
        rowHref={(c) => `/hr/expenses/${c.id}`}
        defaultSort={{ key: "date", dir: "desc" }}
        searchPlaceholder={l("Cari nomor, karyawan, keperluan…", "Search number, employee, purpose…")}
        empty={l("Belum ada klaim.", "No claims yet.")}
      />
    </div>
  );
}
