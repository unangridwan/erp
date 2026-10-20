/**
 * Laporan error browser ke Sentry (atau GlitchTip) bila NEXT_PUBLIC_SENTRY_DSN diisi saat build. SDK dimuat dinamis
 * hanya bila DSN ada. Token di URL (fragmen refresh SSO, token undangan/reset, SAMLResponse) dihapus sebelum dikirim.
 */
type Sentry = typeof import("@sentry/browser");

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
let loading: Promise<Sentry | null> | null = null;

const SENSITIVE = /^(token|refresh|code|state|SAMLResponse|RelayState|password)$/i;

/** Hapus fragmen dan parameter sensitif dari URL. */
export function scrubUrl(value: string): string {
  try {
    const url = new URL(value, "http://x");
    url.hash = "";
    for (const key of [...url.searchParams.keys()])
      if (SENSITIVE.test(key)) url.searchParams.set(key, "[disaring]");
    const out = url.toString();
    return value.startsWith("http") ? out : out.replace(/^http:\/\/x/, "");
  } catch {
    return value.split("#")[0]!;
  }
}

function load(): Promise<Sentry | null> | null {
  if (!dsn || typeof window === "undefined") return null;
  loading ??= import("@sentry/browser")
    .then((S) => {
      S.init({
        dsn,
        environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
        release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
        sendDefaultPii: false,
        beforeSend(event) {
          if (event.request?.url) event.request.url = scrubUrl(event.request.url);
          if (event.request?.headers?.Referer)
            event.request.headers.Referer = scrubUrl(event.request.headers.Referer);
          return event;
        },
        beforeBreadcrumb(crumb) {
          const data = crumb.data as Record<string, unknown> | undefined;
          if (data)
            for (const key of ["url", "from", "to"])
              if (typeof data[key] === "string") data[key] = scrubUrl(data[key] as string);
          return crumb;
        },
      });
      return S;
    })
    .catch(() => null);
  return loading;
}

/** Pasang penangkap error global (window.onerror, unhandledrejection). */
export function initErrorReporting() {
  void load();
}

/** Identitas tanpa data pribadi: ID user & tenant saja. */
export function setErrorUser(user: { userId: string; tenantId: string } | null) {
  void load()?.then((S) => {
    S?.setUser(user ? { id: user.userId } : null);
    S?.setTag("tenant_id", user?.tenantId ?? null);
  });
}

export function reportClientError(error: unknown) {
  void load()?.then((S) => S?.captureException(error));
}
