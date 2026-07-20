import Link from "next/link";
import { SUPPORT_EMAIL } from "@/lib/config";

export const metadata = { title: "Conditions Générales d'Utilisation — Fleet Manager" };

export default function CGUPage() {
  const S = {
    h2: { fontSize: 16, fontWeight: 700, color: "var(--sk-t1)", margin: "32px 0 12px", borderBottom: "1px solid #2a3147", paddingBottom: 8 } as React.CSSProperties,
    p: { color: "#a0aab8", fontSize: 14, lineHeight: 1.7, margin: "0 0 12px" } as React.CSSProperties,
    li: { color: "#a0aab8", fontSize: 14, lineHeight: 1.7, margin: "0 0 6px" } as React.CSSProperties,
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0f1117", color: "var(--sk-t1)", padding: "40px 16px" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>

        <div style={{ marginBottom: 32 }}>
          <Link href="/" style={{ color: "#f5a623", fontSize: 13, textDecoration: "none" }}>← Retour</Link>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: "16px 0 8px" }}>Conditions Générales d&apos;Utilisation</h1>
          <p style={{ color: "#6b7280", fontSize: 13 }}>Fleet Manager by M3A Solutions — Version du 1er juillet 2026</p>
        </div>

        <h2 style={S.h2}>Article 1 — Objet et champ d&apos;application</h2>
        <p style={S.p}>
          Les présentes Conditions Générales d&apos;Utilisation (ci-après « CGU ») régissent l&apos;accès et l&apos;utilisation
          de la plateforme Fleet Manager (ci-après « le Service »), éditée par M3A Solutions, entreprise immatriculée
          au Sénégal, ayant son siège social à Dakar.
        </p>
        <p style={S.p}>
          Le Service est une application SaaS de gestion de flotte de véhicules permettant à des entreprises (ci-après
          « Client ») de gérer leurs chauffeurs, rapports journaliers, paiements et documents KYC via une interface web sécurisée.
        </p>
        <p style={S.p}>
          Toute utilisation du Service implique l&apos;acceptation sans réserve des présentes CGU. Si vous n&apos;acceptez pas
          ces conditions, vous ne devez pas utiliser le Service.
        </p>

        <h2 style={S.h2}>Article 2 — Accès au Service</h2>
        <p style={S.p}>
          L&apos;accès au Service est réservé aux personnes morales ou physiques exerçant une activité professionnelle légale
          au Sénégal ou dans la sous-région CEDEAO. Le Client est responsable de la véracité des informations fournies
          lors de l&apos;inscription.
        </p>
        <p style={S.p}>
          Chaque compte Client dispose d&apos;un espace tenant isolé. Le Client est seul responsable de la confidentialité
          de ses identifiants de connexion et de ceux qu&apos;il crée pour ses collaborateurs.
        </p>
        <p style={S.p}>
          M3A Solutions se réserve le droit de refuser ou de résilier un accès en cas d&apos;usage frauduleux, de violation
          des présentes CGU, ou de non-paiement.
        </p>

        <h2 style={S.h2}>Article 3 — Plans et abonnements</h2>
        <p style={S.p}>Le Service est proposé selon les formules suivantes :</p>
        <ul style={{ paddingLeft: 20, margin: "0 0 12px" }}>
          <li style={S.li}><strong style={{ color: "var(--sk-t1)" }}>Essai gratuit</strong> : 14 jours d&apos;accès complet sans engagement ni carte bancaire.</li>
          <li style={S.li}><strong style={{ color: "var(--sk-t1)" }}>Plan Standard</strong> : jusqu&apos;à 20 chauffeurs, facturation mensuelle.</li>
          <li style={S.li}><strong style={{ color: "var(--sk-t1)" }}>Plan Pro</strong> : chauffeurs illimités, fonctionnalités avancées, facturation mensuelle.</li>
          <li style={S.li}><strong style={{ color: "var(--sk-t1)" }}>Plan Enterprise</strong> : sur devis, contrat annuel, support prioritaire.</li>
        </ul>
        <p style={S.p}>
          Les tarifs en vigueur sont affichés sur la page de paiement du Service et peuvent être modifiés par M3A Solutions
          avec un préavis de 30 jours par email.
        </p>

        <h2 style={S.h2}>Article 4 — Paiement</h2>
        <p style={S.p}>
          Les paiements sont acceptés via Wave, Orange Money Sénégal, ou tout autre moyen convenu avec M3A Solutions.
          L&apos;activation du compte après l&apos;essai gratuit est conditionnée à la réception et à la validation du paiement
          par M3A Solutions.
        </p>
        <p style={S.p}>
          Les abonnements sont mensuels et doivent être renouvelés avant leur échéance pour maintenir l&apos;accès au Service.
          En cas de non-paiement à l&apos;échéance, le compte est suspendu automatiquement après un délai de grâce de 3 jours
          ouvrés, sans suppression des données.
        </p>
        <p style={S.p}>
          Aucun remboursement ne sera effectué pour les périodes entamées, sauf accord exprès de M3A Solutions.
        </p>

        <h2 style={S.h2}>Article 5 — Obligations du Client</h2>
        <p style={S.p}>Le Client s&apos;engage à :</p>
        <ul style={{ paddingLeft: 20, margin: "0 0 12px" }}>
          <li style={S.li}>Utiliser le Service uniquement à des fins légales et dans le cadre de son activité professionnelle.</li>
          <li style={S.li}>Ne pas tenter de contourner les mécanismes de sécurité, d&apos;accéder aux données d&apos;autres clients, ou de surcharger les serveurs.</li>
          <li style={S.li}>Maintenir à jour les informations de son compte et de ses utilisateurs.</li>
          <li style={S.li}>Obtenir les consentements nécessaires avant d&apos;enregistrer des données personnelles de chauffeurs ou tiers.</li>
          <li style={S.li}>Respecter la réglementation sénégalaise applicable à son activité, notamment en matière de droit du travail.</li>
        </ul>

        <h2 style={S.h2}>Article 6 — Propriété intellectuelle</h2>
        <p style={S.p}>
          Le Service, ses composants logiciels, son interface, ses algorithmes et ses contenus sont la propriété exclusive
          de M3A Solutions et sont protégés par les lois applicables en matière de propriété intellectuelle.
        </p>
        <p style={S.p}>
          Le Client conserve la pleine propriété de ses données (rapports, profils chauffeurs, documents) saisies dans le Service.
          M3A Solutions n&apos;acquiert aucun droit sur ces données au-delà de l&apos;hébergement nécessaire à la fourniture du Service.
        </p>

        <h2 style={S.h2}>Article 7 — Disponibilité et maintenance</h2>
        <p style={S.p}>
          M3A Solutions s&apos;engage à fournir un Service disponible 24h/24 et 7j/7, avec un objectif de disponibilité de 99 %
          sur une base mensuelle. Des interruptions planifiées (maintenance) peuvent survenir et seront communiquées
          par email avec un préavis de 48 heures autant que possible.
        </p>
        <p style={S.p}>
          M3A Solutions ne peut être tenu responsable des interruptions liées à des défaillances des fournisseurs tiers
          (Supabase, Vercel, opérateurs télécoms).
        </p>

        <h2 style={S.h2}>Article 8 — Limitation de responsabilité</h2>
        <p style={S.p}>
          Le Service est fourni « en l&apos;état ». M3A Solutions ne peut être tenu responsable de toute perte de données,
          manque à gagner, ou dommage indirect résultant de l&apos;utilisation ou de l&apos;impossibilité d&apos;utiliser le Service.
        </p>
        <p style={S.p}>
          La responsabilité totale de M3A Solutions envers le Client, pour quelque cause que ce soit, est limitée au montant
          des sommes effectivement versées par le Client au cours des 3 derniers mois précédant l&apos;incident.
        </p>

        <h2 style={S.h2}>Article 9 — Protection des données personnelles</h2>
        <p style={S.p}>
          M3A Solutions traite les données personnelles du Client et de ses chauffeurs en qualité de sous-traitant,
          conformément à sa{" "}
          <Link href="/legal/confidentialite" style={{ color: "#f5a623" }}>Politique de Confidentialité</Link>.
          Les données sont hébergées dans l&apos;Union Européenne (Allemagne) via Supabase.
        </p>

        <h2 style={S.h2}>Article 10 — Résiliation</h2>
        <p style={S.p}>
          Le Client peut résilier son abonnement à tout moment en contactant M3A Solutions. La résiliation prend effet
          à la fin de la période en cours. Les données du Client sont conservées pendant 30 jours après la résiliation,
          puis supprimées définitivement sauf obligation légale contraire.
        </p>
        <p style={S.p}>
          M3A Solutions peut résilier le compte du Client avec un préavis de 15 jours en cas de violation répétée des CGU,
          ou immédiatement en cas d&apos;usage frauduleux ou illégal avéré.
        </p>

        <h2 style={S.h2}>Article 11 — Modification des CGU</h2>
        <p style={S.p}>
          M3A Solutions se réserve le droit de modifier les présentes CGU à tout moment. Les modifications entrent en vigueur
          30 jours après leur publication, sauf urgence. Le Client sera notifié par email. La poursuite de l&apos;utilisation
          du Service après ce délai vaut acceptation des nouvelles CGU.
        </p>

        <h2 style={S.h2}>Article 12 — Droit applicable et litiges</h2>
        <p style={S.p}>
          Les présentes CGU sont soumises au droit sénégalais. En cas de litige, les parties s&apos;engagent à tenter une
          résolution amiable dans un délai de 30 jours. À défaut, le litige sera soumis à la compétence exclusive
          des juridictions de Dakar (Sénégal).
        </p>

        <h2 style={S.h2}>Contact</h2>
        <p style={S.p}>
          Pour toute question relative aux présentes CGU :<br />
          <strong style={{ color: "var(--sk-t1)" }}>M3A Solutions</strong> — Dakar, Sénégal<br />
          Email : <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: "#f5a623" }}>{SUPPORT_EMAIL}</a>
        </p>

        <div style={{ borderTop: "1px solid #2a3147", marginTop: 40, paddingTop: 20, display: "flex", gap: 16, flexWrap: "wrap" }}>
          <Link href="/legal/confidentialite" style={{ color: "#f5a623", fontSize: 13 }}>Politique de Confidentialité →</Link>
          <Link href="/register" style={{ color: "#6b7280", fontSize: 13 }}>Créer un compte</Link>
        </div>

      </div>
    </div>
  );
}
