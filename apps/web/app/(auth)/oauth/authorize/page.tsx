"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError, session, type Me } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";

interface ClientInfo {
  name: string;
  tenantSlug: string;
  tenantName: string;
}

/**
 * Login aplikasi terhubung (OpenID Connect): aplikasi mengarahkan user ke sini; bila belum masuk ERP, user login
 * dulu lalu kembali; kode otorisasi dikirim ke redirect URI yang terdaftar.
 */
export default function OAuthAuthorizePage() {
  const { l } = useI18n();
  const [info, setInfo] = useState<ClientInfo | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wrongTenant, setWrongTenant] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const q = new URLSearchParams(window.location.search);
    const toLogin = (slug: string) => {
      // prompt=login dari aplikasi hanya berlaku sekali, agar tidak berputar setelah login.
      const back = new URLSearchParams(q);
      back.delete("prompt");
      window.location.replace(
        `/login?tenant=${encodeURIComponent(slug)}&next=${encodeURIComponent(`${window.location.pathname}?${back}`)}`,
      );
    };
    void (async () => {
      let client: ClientInfo;
      try {
        client = await api<ClientInfo>(
          `/oauth/client?client_id=${encodeURIComponent(q.get("client_id") ?? "")}&redirect_uri=${encodeURIComponent(q.get("redirect_uri") ?? "")}`,
        );
        setInfo(client);
      } catch (e) {
        // redirect_uri belum terverifikasi: jangan arahkan ke mana pun.
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
      if (q.get("prompt") === "login" && session.token()) await session.logout();
      if (!session.token()) return toLogin(client.tenantSlug);
      try {
        setMe(await api<Me>("/auth/me"));
        const { redirectTo } = await api<{ redirectTo: string }>("/oauth/authorize", {
          method: "POST",
          body: {
            clientId: q.get("client_id"),
            redirectUri: q.get("redirect_uri"),
            responseType: q.get("response_type"),
            scope: q.get("scope") ?? "openid",
            state: q.get("state") ?? undefined,
            nonce: q.get("nonce") ?? undefined,
            codeChallenge: q.get("code_challenge") ?? "",
            codeChallengeMethod: q.get("code_challenge_method") ?? "",
          },
        });
        window.location.replace(redirectTo);
      } catch (e) {
        if (e instanceof ApiError && e.status === 403 && /tenant lain|another tenant/.test(e.message))
          setWrongTenant(true);
        setError(e instanceof ApiError ? (Object.values(e.fieldErrors)[0] ?? e.message) : String(e));
      }
    })();
  }, []);

  async function switchAccount() {
    await session.logout();
    const q = new URLSearchParams(window.location.search);
    window.location.replace(
      `/login?tenant=${encodeURIComponent(info?.tenantSlug ?? "")}&next=${encodeURIComponent(`${window.location.pathname}?${q}`)}`,
    );
  }

  return (
    <main className="auth">
      <div className="panel stack">
        <h1>
          {info ? l(`Masuk ke ${info.name}`, `Sign in to ${info.name}`) : l("Masuk ke aplikasi", "Sign in")}
        </h1>
        {info && (
          <p className="muted">
            {l(
              `Memakai akun ERP ${info.tenantName}${me ? ` sebagai ${me.name} (${me.email})` : ""}.`,
              `Using your ${info.tenantName} ERP account${me ? ` as ${me.name} (${me.email})` : ""}.`,
            )}
          </p>
        )}
        {error ? (
          <>
            <p className="error" role="alert">
              {error}
            </p>
            {(wrongTenant || me) && info && (
              <button type="button" onClick={switchAccount}>
                {l("Masuk dengan akun lain", "Use another account")}
              </button>
            )}
          </>
        ) : (
          <p className="muted">{l("Mengalihkan…", "Redirecting…")}</p>
        )}
      </div>
    </main>
  );
}
