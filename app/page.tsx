import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import {
  ScanLine,
  ShieldCheck,
  BarChart3,
  Building2,
  Wallet,
  ClipboardCheck,
  Users,
  Lock,
  Sprout,
  Calculator,
  FileCheck2,
  Palette,
  KeyRound,
  FileLock2,
  ScrollText,
  Phone,
  Mail,
  MapPin,
} from "lucide-react";
import DemoVideo from "@/components/landing/DemoVideo";
import ContactForm from "@/components/landing/ContactForm";

export const metadata: Metadata = {
  title: "M3A Fleet — La réalité du terrain, transformée en vérité financière",
  description:
    "M3A Fleet transforme la réalité du terrain en vérité financière, chaque jour : déclaration chauffeur en 2 minutes, validation gestionnaire, pilotage en temps réel par véhicule. Demandez une démonstration.",
};

const surface = { background: "var(--sk-surface)", border: "1px solid var(--sk-border)" };

// La vitrine M3A Fleet n'a de sens que sur le domaine racine (m3afleet.com).
// Un sous-domaine client (slug.m3afleet.com — même détection que
// lib/tenant/loader.ts::detectSlug) doit continuer à renvoyer vers sa page de
// connexion, jamais afficher le branding M3A ("vos clients ne voient jamais M3A").
async function isClientSubdomain(): Promise<boolean> {
  const host = (await headers()).get("host") || "";
  const hostname = host.split(":")[0];
  if (hostname === "localhost" || hostname === "127.0.0.1") return false;
  return hostname.split(".").length >= 3;
}

export default async function Home() {
  if (await isClientSubdomain()) {
    redirect("/auth/login");
  }

  return (
    <div style={{ background: "var(--sk-bg)", color: "var(--sk-t1)" }}>
      {/* ── HEADER ─────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-30 backdrop-blur"
        style={{ background: "rgba(8,10,15,0.85)", borderBottom: "1px solid var(--sk-surface)" }}
      >
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span
              className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm"
              style={{ background: "#f5a623", color: "#080a0f" }}
            >
              FL
            </span>
            <span className="font-semibold text-lg tracking-tight">M3A Fleet</span>
          </div>
          <nav className="hidden md:flex items-center gap-8 text-sm" style={{ color: "var(--sk-t2)" }}>
            <a href="#solution" className="hover:opacity-80 transition-opacity">Solution</a>
            <a href="#demo" className="hover:opacity-80 transition-opacity">Démo</a>
            <a href="#securite" className="hover:opacity-80 transition-opacity">Sécurité</a>
            <a href="#contact" className="hover:opacity-80 transition-opacity">Contact</a>
          </nav>
          <div className="flex items-center gap-3">
            <Link
              href="/auth/login"
              className="hidden sm:block text-sm font-medium hover:opacity-80 transition-opacity"
              style={{ color: "var(--sk-t2)" }}
            >
              Se connecter
            </Link>
            <a
              href="#contact"
              className="rounded-lg px-4 py-2 text-sm font-semibold cursor-pointer transition-opacity hover:opacity-90"
              style={{ background: "#f5a623", color: "#080a0f" }}
            >
              Demander une démo
            </a>
          </div>
        </div>
      </header>

      {/* ── HERO ───────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-5 sm:px-8 pt-16 pb-20 sm:pt-24 sm:pb-28">
        <div className="grid lg:grid-cols-2 gap-14 items-center">
          <div>
            <span
              className="inline-block text-xs font-semibold tracking-wide uppercase rounded-full px-3 py-1 mb-6"
              style={{ background: "rgba(245,166,35,0.12)", color: "#f5a623" }}
            >
              Gestion de flotte &amp; opérations chauffeurs
            </span>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.1] mb-6">
              Chaque véhicule, chaque chauffeur, chaque franc — visible, validé, traçable.
            </h1>
            <p className="text-lg leading-relaxed mb-9" style={{ color: "var(--sk-t2)" }}>
              M3A Fleet transforme la réalité du terrain en vérité financière, chaque jour.
              Fini les recettes sur cahier, les dépenses sur WhatsApp et l&apos;Excel jamais à
              jour : une seule plateforme, du chauffeur à la direction.
            </p>
            <div className="flex flex-wrap gap-4">
              <a
                href="#contact"
                className="rounded-lg px-6 py-3.5 font-semibold cursor-pointer transition-opacity hover:opacity-90"
                style={{ background: "#f5a623", color: "#080a0f" }}
              >
                Demander une démonstration
              </a>
              <a
                href="#demo"
                className="rounded-lg px-6 py-3.5 font-semibold cursor-pointer transition-colors"
                style={{ border: "1px solid var(--sk-border)", color: "var(--sk-t1)" }}
              >
                Voir la vidéo (4 min)
              </a>
            </div>
          </div>

          {/* Composition dashboard + mobile */}
          <div className="relative">
            <div className="rounded-2xl overflow-hidden shadow-2xl" style={{ border: "1px solid var(--sk-border)" }}>
              <Image
                src="/landing/img/dashboard-desktop.png"
                alt="Dashboard flotte M3A Fleet — net final, recettes, trésorerie en temps réel"
                width={1440}
                height={900}
                priority
                className="w-full h-auto"
              />
            </div>
            <div
              className="hidden sm:block absolute -bottom-10 -left-8 w-40 rounded-2xl overflow-hidden shadow-2xl"
              style={{ border: "3px solid var(--sk-bg)" }}
            >
              <Image
                src="/landing/img/driver-mobile.png"
                alt="Déclaration chauffeur pré-remplie sur mobile"
                width={390}
                height={844}
                className="w-full h-auto"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── PROBLÈME ───────────────────────────────────────────── */}
      <section className="border-y" style={{ borderColor: "var(--sk-surface)", background: "var(--sk-deep)" }}>
        <div className="max-w-4xl mx-auto px-5 sm:px-8 py-16 text-center">
          <p className="text-xl sm:text-2xl leading-relaxed font-medium" style={{ color: "var(--sk-t1)" }}>
            Toute entreprise qui met des véhicules et des hommes sur la route vit le même
            angle mort : <span style={{ color: "#f5a623" }}>ce qui se passe réellement sur le terrain
            n&apos;arrive jamais proprement jusqu&apos;à la direction.</span>
          </p>
          <p className="mt-4" style={{ color: "var(--sk-t2)" }}>
            Recettes, kilomètres, carburant, dépenses — erreurs, litiges, pertes, et zéro
            vision de la rentabilité réelle.
          </p>
        </div>
      </section>

      {/* ── SOLUTION — 3 ÉTAPES ────────────────────────────────── */}
      <section id="solution" className="max-w-6xl mx-auto px-5 sm:px-8 py-20 sm:py-28">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
            La donnée du terrain, en trois mouvements
          </h2>
          <p style={{ color: "var(--sk-t2)" }}>
            Peu importe le métier — transport de personnes, fret, logistique, flotte de
            service — le cycle est le même : déclarer, valider, savoir.
          </p>
        </div>

        <Step
          number="1"
          icon={ScanLine}
          title="CAPTER"
          tagline="La donnée naît là où elle se passe."
          description="Le chauffeur déclare sa journée en 2 minutes depuis son téléphone : recettes, kilométrage, carburant, dépenses avec photo du justificatif. Fonctionne sur Android modeste, en 3G. Sur les plateformes compatibles, il photographie simplement son écran et le compteur — l'IA remplit les champs, il vérifie et soumet."
          image="/landing/img/driver-mobile.png"
          imageWidth={390}
          imageHeight={844}
          reverse={false}
        />
        <Step
          number="2"
          icon={ShieldCheck}
          title="CONTRÔLER"
          tagline="Pas de chiffre sans preuve, pas d'action sans trace."
          description="Rien n'entre dans les chiffres sans validation du gestionnaire. Le moteur de calcul applique le modèle de rémunération configuré et affiche le net. Chaque validation, rejet ou modification est journalisé : qui, quoi, quand."
          image="/landing/img/validation-modal.png"
          imageWidth={1440}
          imageHeight={900}
          reverse={true}
        />
        <Step
          number="3"
          icon={BarChart3}
          title="PILOTER"
          tagline="Chaque véhicule devient un centre de profit visible."
          description="Net réel par jour, par véhicule, par chauffeur. Coût au kilomètre. Rémunérations calculées automatiquement. Alertes sur les déclarations manquantes, rentabilité et projections pour la direction."
          image="/landing/img/dashboard-desktop.png"
          imageWidth={1440}
          imageHeight={900}
          reverse={false}
          last
        />
      </section>

      {/* ── VIDÉO ──────────────────────────────────────────────── */}
      <section id="demo" style={{ background: "var(--sk-deep)" }} className="border-y" >
        <div className="max-w-4xl mx-auto px-5 sm:px-8 py-20 sm:py-28" style={{ borderColor: "var(--sk-surface)" }}>
          <div className="text-center mb-10">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
              La solution en action
            </h2>
            <p style={{ color: "var(--sk-t2)" }}>
              Le flux complet, du chauffeur à la direction — écrans réels, données de
              démonstration.
            </p>
          </div>
          <div className="aspect-video">
            <DemoVideo poster="/landing/img/dashboard-desktop.png" src="/landing/video/m3a-fleet-demo.mp4" />
          </div>
        </div>
      </section>

      {/* ── BÉNÉFICES PAR RÔLE ─────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-5 sm:px-8 py-20 sm:py-28">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
            À chacun son bénéfice
          </h2>
          <p style={{ color: "var(--sk-t2)" }}>
            L&apos;interface s&apos;adapte à son utilisateur — mode simple pour un responsable
            non technique, mode avancé pour un contrôleur de gestion.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          <BenefitCard
            icon={Building2}
            title="Direction générale"
            text="La réponse à LA question : ma flotte gagne-t-elle de l'argent, véhicule par véhicule ?"
          />
          <BenefitCard
            icon={Wallet}
            title="Direction financière"
            text="Des chiffres tracés et auditables, des justificatifs centralisés, des exports comptables."
          />
          <BenefitCard
            icon={ClipboardCheck}
            title="Responsable d'exploitation"
            text="Fin de la collecte manuelle : validation en un geste, alertes sur les déclarations manquantes, litiges réglés par les preuves."
          />
          <BenefitCard
            icon={Users}
            title="Chauffeurs"
            text="Transparence totale sur leur activité et leur net à percevoir — moins de contestations, plus de confiance."
          />
          <BenefitCard
            icon={Lock}
            title="DSI"
            text="Une solution isolée par entreprise, chiffrée, journalisée, réversible — dossier sécurité dédié disponible."
          />
          <BenefitCard
            icon={Palette}
            title="Votre marque"
            text="Logo, couleurs, nom de l'application : chaque client a son identité. Vos équipes ne voient jamais M3A."
          />
        </div>
      </section>

      {/* ── CE QUI DISTINGUE ───────────────────────────────────── */}
      <section style={{ background: "var(--sk-deep)" }} className="border-y" >
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20 sm:py-28" style={{ borderColor: "var(--sk-surface)" }}>
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
              Ce qui distingue M3A Fleet
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-x-10 gap-y-10">
            <Differentiator
              icon={Sprout}
              title="Né du terrain"
              text="Construit d'abord pour la propre flotte de M3A Group à Dakar, puis industrialisé. Chaque écran répond à un problème réellement vécu."
            />
            <Differentiator
              icon={Calculator}
              title="Rigueur des calculs"
              text="Un moteur de calcul unique et testé (140+ tests automatisés) fait foi pour commissions, rémunérations et résultats. Modèles paramétrables par chauffeur."
            />
            <Differentiator
              icon={ShieldCheck}
              title="Sécurité de niveau entreprise"
              text="Isolation stricte des données par client, chiffrement, journaux d'audit, validation des fichiers — dossier sécurité disponible sur demande."
            />
            <Differentiator
              icon={FileCheck2}
              title="Traçabilité totale"
              text="Chaque validation, modification et paiement est journalisé : qui, quoi, quand."
            />
          </div>
        </div>
      </section>

      {/* ── MODE SIMPLE / AVANCÉ ───────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-5 sm:px-8 py-20 sm:py-28">
        <div className="grid lg:grid-cols-2 gap-14 items-center">
          <div>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-5">
              Une interface qui s&apos;adapte à son utilisateur
            </h2>
            <p className="mb-4" style={{ color: "var(--sk-t2)" }}>
              <strong style={{ color: "var(--sk-t1)" }}>Mode simple</strong> pour un propriétaire
              non technique : 3 écrans, la file « à valider » et le net — rien d&apos;autre.
            </p>
            <p style={{ color: "var(--sk-t2)" }}>
              <strong style={{ color: "var(--sk-t1)" }}>Mode avancé</strong> pour un contrôleur
              de gestion : compte de résultat opérationnel, analyses, exports. La bascule se
              fait à tout moment, par client.
            </p>
          </div>
          <div className="rounded-2xl overflow-hidden shadow-xl" style={{ border: "1px solid var(--sk-border)" }}>
            <Image
              src="/landing/img/mode-simple.png"
              alt="Mode simple — accueil avec file de validation et net du mois"
              width={1440}
              height={900}
              className="w-full h-auto"
            />
          </div>
        </div>
      </section>

      {/* ── SÉCURITÉ ───────────────────────────────────────────── */}
      <section id="securite" style={{ background: "var(--sk-deep)" }} className="border-y">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20 sm:py-28" style={{ borderColor: "var(--sk-surface)" }}>
          <div className="text-center max-w-2xl mx-auto mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
              Sécurité de niveau entreprise
            </h2>
            <p style={{ color: "var(--sk-t2)" }}>
              En production continue depuis 2026, avec des flottes réelles à Dakar.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <TrustItem icon={KeyRound} text="Isolation stricte des données par client" />
            <TrustItem icon={FileLock2} text="Chiffrement en transit (TLS) et au repos (AES-256)" />
            <TrustItem icon={ScrollText} text="Journal d'audit sur chaque action sensible" />
            <TrustItem icon={ShieldCheck} text="140+ tests automatisés, supervision d'erreurs 24/7" />
          </div>
          <p className="text-center text-sm mt-10" style={{ color: "var(--sk-t3)" }}>
            Conformité loi sénégalaise 2008-12 (CDP), principes alignés RGPD. Dossier Sécurité
            &amp; Protection des données transmis sur demande.
          </p>
        </div>
      </section>

      {/* ── DEUX MODES DE MISE À DISPOSITION ───────────────────── */}
      <section className="max-w-6xl mx-auto px-5 sm:px-8 py-20 sm:py-28">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
            Deux façons de démarrer
          </h2>
          <p style={{ color: "var(--sk-t2)" }}>
            Les conditions financières font l&apos;objet d&apos;une proposition adaptée à votre
            périmètre — on en discute lors de la démonstration.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-6">
          <div className="rounded-2xl p-8" style={surface}>
            <h3 className="text-lg font-semibold mb-1">Instance dédiée entreprise</h3>
            <p className="text-sm mb-6" style={{ color: "var(--sk-t3)" }}>Grands comptes, exigences de sécurité élevées</p>
            <ul className="space-y-3 text-sm" style={{ color: "var(--sk-t2)" }}>
              <li>Base de données et domaine dédiés au client</li>
              <li>Marque blanche complète + adaptations métier</li>
              <li>Projet d&apos;intégration avec votre IT</li>
              <li>Support avec engagements renforcés</li>
            </ul>
          </div>
          <div className="rounded-2xl p-8" style={{ ...surface, borderColor: "#f5a623" }}>
            <h3 className="text-lg font-semibold mb-1">SaaS accompagné</h3>
            <p className="text-sm mb-6" style={{ color: "var(--sk-t3)" }}>PME, démarrage rapide</p>
            <ul className="space-y-3 text-sm" style={{ color: "var(--sk-t2)" }}>
              <li>Plateforme mutualisée, données isolées</li>
              <li>Marque blanche (logo, couleurs)</li>
              <li>Espace prêt en 24 h</li>
              <li>Support standard</li>
            </ul>
          </div>
        </div>
      </section>

      {/* ── PROCHAINES ÉTAPES ──────────────────────────────────── */}
      <section style={{ background: "var(--sk-deep)" }} className="border-y">
        <div className="max-w-5xl mx-auto px-5 sm:px-8 py-20 sm:py-28" style={{ borderColor: "var(--sk-surface)" }}>
          <div className="text-center max-w-2xl mx-auto mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
              Comment démarrer
            </h2>
          </div>
          <div className="grid sm:grid-cols-3 gap-6">
            <ProcessStep n={1} title="Démonstration" text="30 minutes, en ligne ou à Dakar, sur un environnement de démonstration." />
            <ProcessStep n={2} title="Pilote" text="30 jours sur un sous-ensemble de véhicules, avec vos données réelles." />
            <ProcessStep n={3} title="Déploiement" text="Selon le mode choisi, avec formation des gestionnaires et des chauffeurs." />
          </div>
        </div>
      </section>

      {/* ── CONTACT ────────────────────────────────────────────── */}
      <section id="contact" className="max-w-5xl mx-auto px-5 sm:px-8 py-20 sm:py-28">
        <div className="grid lg:grid-cols-5 gap-12">
          <div className="lg:col-span-2">
            <h2 className="text-3xl font-bold tracking-tight mb-4">
              Parlons de votre flotte
            </h2>
            <p className="mb-8" style={{ color: "var(--sk-t2)" }}>
              Laissez-nous vos coordonnées, nous revenons vers vous pour organiser une
              démonstration adaptée à votre activité.
            </p>
            <div className="space-y-4 text-sm" style={{ color: "var(--sk-t2)" }}>
              <a href="tel:+221787600330" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                <Phone size={18} style={{ color: "#f5a623" }} /> +221 78 760 03 30
              </a>
              <a href="mailto:gueye.a66@gmail.com" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                <Mail size={18} style={{ color: "#f5a623" }} /> gueye.a66@gmail.com
              </a>
              <p className="flex items-center gap-3">
                <MapPin size={18} style={{ color: "#f5a623" }} /> Dakar, Sénégal
              </p>
            </div>
          </div>
          <div className="lg:col-span-3">
            <ContactForm />
          </div>
        </div>
      </section>

      {/* ── FOOTER ─────────────────────────────────────────────── */}
      <footer style={{ borderTop: "1px solid var(--sk-surface)" }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-10 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm" style={{ color: "var(--sk-t3)" }}>
          <div className="flex items-center gap-2.5">
            <span
              className="w-7 h-7 rounded-md flex items-center justify-center font-bold text-xs"
              style={{ background: "#f5a623", color: "#080a0f" }}
            >
              FL
            </span>
            <span>M3A Fleet — un produit de M3A Group</span>
          </div>
          <div className="flex items-center gap-6">
            <span>NINEA 011198547 · RCCM SN DKR 2025 A 19125</span>
            <Link href="/auth/login" className="hover:opacity-80 transition-opacity">Se connecter</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ── Sous-composants (server) ──────────────────────────────────

function Step({
  number,
  icon: Icon,
  title,
  tagline,
  description,
  image,
  imageWidth,
  imageHeight,
  reverse,
  last,
}: {
  number: string;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  title: string;
  tagline: string;
  description: string;
  image: string;
  imageWidth: number;
  imageHeight: number;
  reverse: boolean;
  last?: boolean;
}) {
  return (
    <div className={`grid lg:grid-cols-2 gap-10 items-center ${last ? "" : "mb-16 sm:mb-24"}`}>
      <div className={reverse ? "lg:order-2" : ""}>
        <div className="flex items-center gap-3 mb-4">
          <span
            className="w-10 h-10 rounded-full flex items-center justify-center font-bold"
            style={{ background: "rgba(245,166,35,0.12)", color: "#f5a623" }}
          >
            {number}
          </span>
          <Icon size={22} style={{ color: "#f5a623" }} />
          <h3 className="text-2xl font-bold tracking-tight">{title}</h3>
        </div>
        <p className="text-lg font-medium mb-3" style={{ color: "var(--sk-t1)" }}>{tagline}</p>
        <p className="leading-relaxed" style={{ color: "var(--sk-t2)" }}>{description}</p>
      </div>
      <div className={reverse ? "lg:order-1" : ""}>
        <div className="rounded-2xl overflow-hidden shadow-xl max-w-sm mx-auto lg:max-w-none" style={{ border: "1px solid var(--sk-border)" }}>
          <Image src={image} alt={title} width={imageWidth} height={imageHeight} className="w-full h-auto" loading="lazy" />
        </div>
      </div>
    </div>
  );
}

function BenefitCard({
  icon: Icon,
  title,
  text,
}: {
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-2xl p-6" style={surface}>
      <Icon size={22} style={{ color: "#f5a623" }} />
      <h3 className="font-semibold mt-4 mb-2">{title}</h3>
      <p className="text-sm leading-relaxed" style={{ color: "var(--sk-t2)" }}>{text}</p>
    </div>
  );
}

function Differentiator({
  icon: Icon,
  title,
  text,
}: {
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  title: string;
  text: string;
}) {
  return (
    <div className="flex gap-4">
      <span
        className="shrink-0 w-11 h-11 rounded-xl flex items-center justify-center"
        style={{ background: "rgba(245,166,35,0.12)" }}
      >
        <Icon size={20} style={{ color: "#f5a623" }} />
      </span>
      <div>
        <h3 className="font-semibold mb-1.5">{title}</h3>
        <p className="text-sm leading-relaxed" style={{ color: "var(--sk-t2)" }}>{text}</p>
      </div>
    </div>
  );
}

function TrustItem({
  icon: Icon,
  text,
}: {
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties; className?: string }>;
  text: string;
}) {
  return (
    <div className="rounded-2xl p-6 text-center" style={surface}>
      <Icon size={24} style={{ color: "#38bdf8" }} className="mx-auto mb-3" />
      <p className="text-sm leading-relaxed" style={{ color: "var(--sk-t2)" }}>{text}</p>
    </div>
  );
}

function ProcessStep({ n, title, text }: { n: number; title: string; text: string }) {
  return (
    <div className="rounded-2xl p-7" style={surface}>
      <span className="text-3xl font-bold" style={{ color: "#f5a623" }}>{n}</span>
      <h3 className="font-semibold text-lg mt-3 mb-2">{title}</h3>
      <p className="text-sm leading-relaxed" style={{ color: "var(--sk-t2)" }}>{text}</p>
    </div>
  );
}
