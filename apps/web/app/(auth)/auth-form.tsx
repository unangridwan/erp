"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, ApiError, session } from "../../lib/api";

interface Props {
  mode: "login" | "signup";
}

export function AuthForm({ mode }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const body = Object.fromEntries(new FormData(e.currentTarget));
      const { token } = await api<{ token: string }>(`/auth/${mode}`, { method: "POST", body });
      session.clear();
      session.setToken(token);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal");
      if (err instanceof ApiError) setFieldErrors(err.fieldErrors);
    } finally {
      setBusy(false);
    }
  }

  const field = (name: string, label: string, type = "text") => (
    <label className="field">
      <span>{label}</span>
      <input
        name={name}
        type={type}
        required
        autoComplete={type === "password" ? "current-password" : name}
      />
      {fieldErrors[name] && <small className="error">{fieldErrors[name]}</small>}
    </label>
  );

  return (
    <main className="auth">
      <form className="panel" onSubmit={onSubmit}>
        <h1>{mode === "login" ? "Masuk" : "Daftar perusahaan baru"}</h1>
        {field("tenantSlug", "ID perusahaan (slug)")}
        {mode === "signup" && field("companyName", "Nama perusahaan / holding")}
        {mode === "signup" && field("name", "Nama Anda")}
        {field("email", "Email", "email")}
        {field("password", "Password", "password")}
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>
          {busy ? "Memproses…" : mode === "login" ? "Masuk" : "Daftar"}
        </button>
        <p className="muted">
          {mode === "login" ? (
            <>
              Belum punya akun? <Link href="/signup">Daftar</Link>
            </>
          ) : (
            <>
              Sudah punya akun? <Link href="/login">Masuk</Link>
            </>
          )}
        </p>
      </form>
    </main>
  );
}
