import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
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

// width/initialScale explicites (valeurs Next par défaut) : la page fait la
// largeur de l'écran, sans dézoom initial.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
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
      // data-theme / data-ui sont posés par le script inline avant l'hydratation
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        {/* Thème clair/sombre : appliqué AVANT le premier rendu (pas de flash).
            Préférence par appareil — voir components/ThemeToggle. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              `try{if(localStorage.getItem("m3a-theme")==="light")document.documentElement.dataset.theme="light"}catch(e){}` +
              // Refonte UI v2 : forçage appareil (QA) OU dernier drapeau tenant
              // connu (m3a-ui-tenant) — typo scopée posée avant le 1er rendu,
              // pas de flash de l'ancienne version le temps de la réponse réseau.
              `try{if(localStorage.getItem("m3a-ui")==="v2"||localStorage.getItem("m3a-ui-tenant")==="1")document.documentElement.dataset.ui="v2"}catch(e){}` +
              // iOS zoome sur tout champ < 16 px au focus et RESTE zoomé : l'écran
              // déborde puis paraît mal cadré. maximum-scale=1 ne coupe sur iOS
              // QUE ce zoom auto (le pincer-zoomer reste permis depuis iOS 10) ;
              // pas posé ailleurs, où il bloquerait le zoom manuel.
              `try{if(/iP(hone|ad|od)/.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1)){var m=document.querySelector('meta[name="viewport"]');if(m&&m.content.indexOf("maximum-scale")<0)m.content+=", maximum-scale=1"}}catch(e){}`,
          }}
        />
        <PwaRegister />
        <TenantProvider>
          <AuthProvider>{children}</AuthProvider>
        </TenantProvider>
              <Analytics />
      </body>
    </html>
  );
}
