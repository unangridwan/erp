import type { ReactNode } from "react";
import { ErrorReporting } from "../components/error-reporting";
import { I18nProvider } from "../lib/i18n";
import "./globals.css";

export const metadata = { title: "ERP", description: "ERP SaaS multi-tenant" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <body>
        <ErrorReporting />
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
