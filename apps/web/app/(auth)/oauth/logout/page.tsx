"use client";

import { useEffect, useRef, useState } from "react";
import { api, session } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";

/** Logout dari aplikasi terhubung (end_session_endpoint): keluar dari ERP, lalu kembali ke aplikasi bila terdaftar. */
export default function OAuthLogoutPage() {
  const { l } = useI18n();
  const [done, setDone] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const q = new URLSearchParams(window.location.search);
    void (async () => {
      const { redirectTo } = await api<{ redirectTo: string | null }>("/oauth/logout", {
        method: "POST",
        body: {
          client_id: q.get("client_id") ?? undefined,
          id_token_hint: q.get("id_token_hint") ?? undefined,
          post_logout_redirect_uri: q.get("post_logout_redirect_uri") ?? undefined,
          state: q.get("state") ?? undefined,
        },
      }).catch(() => ({ redirectTo: null }));
      await session.logout();
      if (redirectTo) window.location.replace(redirectTo);
      else setDone(true);
    })();
  }, []);

  return (
    <main className="auth">
      <div className="panel stack">
        <h1>{l("Keluar", "Sign out")}</h1>
        {done ? (
          <>
            <p>{l("Anda sudah keluar dari ERP.", "You have signed out of the ERP.")}</p>
            <a href="/login">{l("Masuk lagi", "Sign in again")}</a>
          </>
        ) : (
          <p className="muted">{l("Memproses…", "Signing you out…")}</p>
        )}
      </div>
    </main>
  );
}
