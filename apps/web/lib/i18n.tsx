"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type Locale = "id" | "en";
/** Teks dua bahasa untuk label yang didefinisikan di konfigurasi (resource, menu). */
export interface Text {
  id: string;
  en: string;
}
export const L = (id: string, en: string): Text => ({ id, en });

const MESSAGES = {
  "app.loading": L("Memuat…", "Loading…"),
  "app.skip": L("Lewati ke konten utama", "Skip to main content"),
  "app.activeCompany": L("Perusahaan aktif", "Active company"),
  "app.logout": L("Keluar", "Sign out"),
  "app.language": L("Bahasa", "Language"),
  "nav.settings": L("Pengaturan", "Settings"),
  "nav.users": L("Pengguna", "Users"),
  "nav.security": L("Keamanan", "Security"),
  "auth.login": L("Masuk", "Sign in"),
  "auth.signup": L("Daftar perusahaan baru", "Register a new company"),
  "auth.signupButton": L("Daftar", "Register"),
  "auth.tenant": L("ID perusahaan (slug)", "Company ID (slug)"),
  "auth.companyName": L("Nama perusahaan / holding", "Company / holding name"),
  "auth.name": L("Nama Anda", "Your name"),
  "auth.email": L("Email", "Email"),
  "auth.password": L("Password", "Password"),
  "auth.code": L("Kode 2FA (6 digit)", "2FA code (6 digits)"),
  "auth.noAccount": L("Belum punya akun?", "No account yet?"),
  "auth.haveAccount": L("Sudah punya akun?", "Already have an account?"),
  "auth.processing": L("Memproses…", "Processing…"),
  "invite.title": L("Terima undangan", "Accept invitation"),
  "invite.intro": L("Anda diundang ke", "You have been invited to"),
  "invite.setPassword": L("Buat password", "Create password"),
  "invite.invalid": L(
    "Undangan tidak valid atau sudah kedaluwarsa.",
    "This invitation is invalid or has expired.",
  ),
  "list.search": L("Cari…", "Search…"),
  "list.new": L("Baru", "New"),
  "list.empty": L("Belum ada data.", "No records yet."),
  "list.of": L("dari", "of"),
  "list.export": L("Ekspor", "Export"),
  "list.import": L("Impor CSV/Excel", "Import CSV/Excel"),
  "list.imported": L(
    "Impor selesai: {created} dibuat, {updated} diperbarui.",
    "Import done: {created} created, {updated} updated.",
  ),
  "list.row": L("Baris", "Row"),
  "form.new": L("baru", "new"),
  "form.save": L("Simpan", "Save"),
  "form.saving": L("Menyimpan…", "Saving…"),
  "form.delete": L("Hapus", "Delete"),
  "form.confirmDelete": L("Hapus data ini?", "Delete this record?"),
  "chatter.title": L("Aktivitas", "Activity"),
  "chatter.empty": L("Belum ada aktivitas.", "No activity yet."),
  "chatter.create": L("membuat", "created"),
  "chatter.update": L("mengubah", "updated"),
  "chatter.delete": L("menghapus", "deleted"),
  "chatter.comment": L("mencatat", "noted"),
  "chatter.system": L("Sistem", "System"),
  "home.welcome": L("Selamat datang", "Welcome"),
  "home.start": L("Mulai dari master data", "Start with master data"),
  "home.modules": L("Modul", "Modules"),
  "users.title": L("Pengguna", "Users"),
  "users.invite": L("Undang pengguna", "Invite user"),
  "users.send": L("Kirim undangan", "Send invitation"),
  "users.sent": L("Undangan dikirim ke {email}.", "Invitation sent to {email}."),
  "users.pending": L("Undangan tertunda", "Pending invitations"),
  "users.roles": L("Peran", "Roles"),
  "users.status": L("Status", "Status"),
  "users.active": L("Aktif", "Active"),
  "users.inactive": L("Nonaktif", "Inactive"),
  "users.companies": L("Perusahaan", "Companies"),
  "users.expires": L("Berlaku sampai", "Expires"),
  "security.title": L("Keamanan akun", "Account security"),
  "security.2faOn": L("Autentikasi dua langkah (2FA) aktif.", "Two-factor authentication (2FA) is on."),
  "security.2faOff": L(
    "Autentikasi dua langkah (2FA) belum aktif.",
    "Two-factor authentication (2FA) is off.",
  ),
  "security.setup": L("Aktifkan 2FA", "Enable 2FA"),
  "security.scan": L(
    "Pindai kode QR dengan aplikasi authenticator, atau masukkan secret secara manual, lalu masukkan kode 6 digit.",
    "Scan the QR code with an authenticator app, or enter the secret manually, then enter the 6-digit code.",
  ),
  "security.confirm": L("Konfirmasi", "Confirm"),
  "security.disable": L("Nonaktifkan 2FA", "Disable 2FA"),
} satisfies Record<string, Text>;

export type MessageKey = keyof typeof MESSAGES;

interface I18n {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  tx: (text: Text) => string;
  /** Teks dua bahasa langsung di tempat (untuk halaman modul). */
  l: (id: string, en: string) => string;
}

const I18nContext = createContext<I18n | null>(null);
const STORAGE_KEY = "erp.locale";

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("id");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "id" || saved === "en") setLocaleState(saved);
    } catch {
      // penyimpanan tidak tersedia
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // penyimpanan tidak tersedia
    }
  }, []);

  const tx = useCallback((text: Text) => text[locale], [locale]);
  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) =>
      MESSAGES[key][locale].replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name] ?? "")),
    [locale],
  );

  const l = useCallback((id: string, en: string) => (locale === "id" ? id : en), [locale]);

  return <I18nContext.Provider value={{ locale, setLocale, t, tx, l }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n dipakai di luar I18nProvider");
  return ctx;
}

export function LocaleSwitch() {
  const { locale, setLocale, t } = useI18n();
  return (
    <select
      aria-label={t("app.language")}
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
    >
      <option value="id">Bahasa Indonesia</option>
      <option value="en">English</option>
    </select>
  );
}
