"use client";

import { PARTNER_BANK_CODES, PARTNER_BANK_LABEL, type PartnerBankCode } from "@erp/shared";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { can } from "../../lib/resources";
import { ask, toast } from "../feedback";
import { useMe } from "../me-context";

interface BankAccount {
  id: string;
  bankCode: PartnerBankCode;
  bankName: string;
  bankIdentifier: string | null;
  accountNumber: string;
  accountHolder: string;
  isDefault: boolean;
  active: boolean;
}
const empty = {
  bankCode: "bca" as PartnerBankCode,
  bankName: "BCA",
  bankIdentifier: "",
  accountNumber: "",
  accountHolder: "",
  isDefault: false,
  active: true,
};

/** Rekening bank kontak (pemasok) untuk payment run & file transfer massal. */
export function BankAccountsPanel({ id }: { id: string }) {
  const me = useMe();
  const { l } = useI18n();
  const [rows, setRows] = useState<BankAccount[] | null>(null);
  const [form, setForm] = useState<(typeof empty & { id?: string }) | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const writable = can(me.permissions, "accounting.manage");
  const load = useCallback(
    () =>
      api<BankAccount[]>(`/partners/${id}/bank-accounts`)
        .then(setRows)
        .catch(() => setRows(null)),
    [id],
  );
  useEffect(() => {
    if (can(me.permissions, "accounting.read")) void load();
  }, [load, me.permissions]);
  if (!rows) return null;

  const save = async () => {
    if (!form) return;
    setErrors({});
    try {
      const { id: accountId, ...body } = form;
      const next = await api<BankAccount[]>(
        accountId ? `/partners/${id}/bank-accounts/${accountId}` : `/partners/${id}/bank-accounts`,
        {
          method: accountId ? "PUT" : "POST",
          body: { ...body, bankIdentifier: body.bankIdentifier || null },
        },
      );
      setRows(next);
      setForm(null);
      toast.success(l("Rekening disimpan", "Bank account saved"));
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const remove = async (b: BankAccount) => {
    if (
      !(await ask({
        message: l(`Hapus rekening ${b.accountNumber}?`, `Delete account ${b.accountNumber}?`),
        danger: true,
      }))
    )
      return;
    try {
      await api(`/partners/${id}/bank-accounts/${b.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const err = (k: string) => errors[k] && <small className="error">{errors[k]}</small>;

  return (
    <section className="panel">
      <h2>{l("Rekening bank", "Bank accounts")}</h2>
      <p className="muted">
        {l(
          "Dipakai payment run untuk membayar tagihan pemasok dan membuat file transfer massal.",
          "Used by payment runs to pay vendor bills and build bulk transfer files.",
        )}
      </p>
      {rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l("Bank", "Bank")}</th>
                <th>{l("Nomor rekening", "Account number")}</th>
                <th>{l("Atas nama", "Account holder")}</th>
                <th>{l("Status", "Status")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td>{b.bankName}</td>
                  <td>{b.accountNumber}</td>
                  <td>{b.accountHolder}</td>
                  <td>
                    {b.isDefault && <span className="pill ok">{l("Utama", "Default")}</span>}{" "}
                    {!b.active && <span className="muted">{l("Nonaktif", "Inactive")}</span>}
                  </td>
                  <td>
                    {writable && (
                      <>
                        <button
                          type="button"
                          className="link"
                          onClick={() => setForm({ ...b, bankIdentifier: b.bankIdentifier ?? "" })}
                        >
                          {l("Ubah", "Edit")}
                        </button>{" "}
                        <button type="button" className="link danger" onClick={() => void remove(b)}>
                          {l("Hapus", "Delete")}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {writable && !form && (
        <button type="button" onClick={() => setForm({ ...empty })}>
          + {l("Tambah rekening", "Add bank account")}
        </button>
      )}
      {form && (
        <div className="fields">
          <label className="field">
            <span>{l("Bank", "Bank")}</span>
            <select
              value={form.bankCode}
              onChange={(e) => {
                const code = e.target.value as PartnerBankCode;
                setForm({
                  ...form,
                  bankCode: code,
                  bankName: code === "other" ? "" : PARTNER_BANK_LABEL[code],
                });
              }}
            >
              {PARTNER_BANK_CODES.map((c) => (
                <option key={c} value={c}>
                  {c === "other" ? l("Bank lain", "Other bank") : PARTNER_BANK_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          {form.bankCode === "other" && (
            <label className="field">
              <span>{l("Nama bank *", "Bank name *")}</span>
              <input value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} />
              {err("bankName")}
            </label>
          )}
          <label className="field">
            <span>{l("Nomor rekening *", "Account number *")}</span>
            <input
              inputMode="numeric"
              value={form.accountNumber}
              onChange={(e) => setForm({ ...form, accountNumber: e.target.value })}
            />
            {err("accountNumber")}
          </label>
          <label className="field">
            <span>{l("Atas nama *", "Account holder *")}</span>
            <input
              value={form.accountHolder}
              onChange={(e) => setForm({ ...form, accountHolder: e.target.value })}
            />
            {err("accountHolder")}
          </label>
          <label className="field">
            <span>{l("Kode bank / SWIFT", "Bank code / SWIFT")}</span>
            <input
              value={form.bankIdentifier}
              onChange={(e) => setForm({ ...form, bankIdentifier: e.target.value })}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
            />
            {l("Rekening utama", "Default account")}
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
            {l("Aktif", "Active")}
          </label>
          <div className="cp-right">
            <button type="button" onClick={() => setForm(null)}>
              {l("Batal", "Cancel")}
            </button>{" "}
            <button type="button" className="primary" onClick={save}>
              {l("Simpan", "Save")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
