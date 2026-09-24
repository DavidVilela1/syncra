import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { LegalDialogProvider } from "~/components/legal/legal-dialog";
import { TRPCReactProvider } from "~/trpc/react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Syncra", template: "%s · Syncra" },
  description: "Real-time collaborative planning for engineering teams.",
};

export const viewport: Viewport = {
  themeColor: "#09090b",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`dark ${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <TRPCReactProvider>
          <LegalDialogProvider>{children}</LegalDialogProvider>
        </TRPCReactProvider>
      </body>
    </html>
  );
}
