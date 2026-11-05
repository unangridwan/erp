import type { ReactNode } from "react";
import { ErrorReporting } from "../components/error-reporting";
import { FeedbackHost } from "../components/feedback";
import { I18nProvider } from "../lib/i18n";
import { THEME_INIT_SCRIPT } from "../lib/theme";
import "./globals.css";

export const metadata = { title: "ERP", description: "ERP SaaS multi-tenant" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // Atribut data-theme dipasang skrip sebelum hidrasi, jadi perbedaan atribut <html> diabaikan.
    <html lang="id" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <ErrorReporting />
        <I18nProvider>
          {children}
          <FeedbackHost />
        </I18nProvider>
      </body>
    </html>
  );
}
