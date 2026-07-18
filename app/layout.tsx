import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/lib/auth/context";
import { TenantProvider } from "@/lib/tenant/context";
import PwaRegister from "@/components/PwaRegister";
import "./globals.css";

export const dynamic = "force-dynamic";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Titre neutre — remplacé côté client par le nom d'app du tenant (TenantProvider)
export const metadata: Metadata = {
  title: "Fleet Manager",
  description: "Plateforme de gestion de flotte — by M3A Solutions",
  manifest: "/manifest.json",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: "#16283c",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <PwaRegister />
        <TenantProvider>
          <AuthProvider>{children}</AuthProvider>
        </TenantProvider>
      </body>
    </html>
  );
}
