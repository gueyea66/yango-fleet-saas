import Link from "next/link";
import { PRIVACY_EMAIL } from "@/lib/config";

export const metadata = { title: "Politique de Confidentialité — Fleet Manager" };

export default function ConfidentialitePage() {
  const S = {
    h2: { fontSize: 16, fontWeight: 700, color: "#f0f2f7", margin: "32px 0 12px", borderBottom: "1px solid #2a3147", paddingBottom: 8 } as React.CSSProperties,
    p: { color: "#a0aab8", fontSize: 14, lineHeight: 1.7, margin: "0 0 12px" } as React.CSSProperties,
    li: { color: "#a0aab8", fontSize: 14, lineHeight: 1.7, margin: "0 0 6px" } as React.CSSProperties,
    table: { width: "100%", borderCollapse: "collapse" as const, marginBottom: 16 },
    th: { color: "#f5a623", fontSize: 12, textAlign: "left" as const, padding: "8px 12px", borderBottom: "1px solid #2a3147", fontWeight: 700 },
    td: { color: "#a0aab8", fontSize: 13, padding: "8px 12px", borderBottom: "1px solid #1a1f2e" },
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0f1117", color: "#f0f2f7", padding: "40px 16px" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>

        <div style={{ marginBottom: 32 }}>
          <Link href="/" style={{ color: "#f5a623", fontSize: 13, textDecoration: "none" }}>← Retour</Link>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: "16px 0 8px" }}>Politique de Confidentialité</h1>
          <p style={{ color: "#6b7280", fontSize: 13 }}>Fleet Manager by M3A Solutions — Version du 1er juillet 2026</p>
        </div>

        <h2 style={S.h2}>1. Responsable du traitement</h2>
        <p style={S.p}>
          Le responsable du traitement des données à caractère personnel collectées via le Service est :<br />
          <strong style={{ color: "#f0f2f7" }}>M3A Solutions</strong>, Dakar, Sénégal.<br />
          Contact DPO : <a href={`mailto:${PRIVACY_EMAIL}`} style={{ color: "#f5a623" }}>{PRIVACY_EMAIL}</a>
        </p>

        <h2 style={S.h2}>2. Données collectées</h2>
        <p style={S.p}>Dans le cadre de la fourniture du Service, nous collectons les catégories de données suivantes :</p>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Catégorie</th>
              <th style={S.th}>Données</th>
              <th style={S.th}>Source</th>
            </tr>
          </thead>
          <tbody>
            <tr><td style={S.td}>Compte Client</td><td style={S.td}>Email, nom société, mot de passe (haché)</td><td style={S.td}>Inscription</td></tr>
            <tr><td style={S.td}>Chauffeurs</td><td style={S.td}>Identifiant, nom complet, email virtuel</td><td style={S.td}>Admin Client</td></tr>
            <tr><td style={S.td}>Documents KYC</td><td style={S.td}>Pièce d&apos;identité, permis de conduire (fichiers)</td><td style={S.td}>Chauffeur</td></tr>
            <tr><td style={S.td}>Activité opérationnelle</td><td style={S.td}>Rapports journaliers, paiements, avances</td><td style={S.td}>Admin/Chauffeur</td></tr>
            <tr><td style={S.td}>Logs techniques</td><td style={S.td}>IP, user-agent, actions (audit log)</td><td style={S.td}>Automatique</td></tr>
            <tr><td style={S.td}>Paiement</td><td style={S.td}>Montant, référence (aucune donnée bancaire)</td><td style={S.td}>Client</td></tr>
          </tbody>
        </table>
        <p style={S.p}>
          Nous ne collectons aucune donnée de carte bancaire. Les paiements sont effectués directement via Wave ou
          Orange Money sans transit par nos serveurs.
        </p>

        <h2 style={S.h2}>3. Finalités et base légale du traitement</h2>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Finalité</th>
              <th style={S.th}>Base légale</th>
            </tr>
          </thead>
          <tbody>
            <tr><td style={S.td}>Fourniture du Service (gestion de flotte)</td><td style={S.td}>Exécution du contrat</td></tr>
            <tr><td style={S.td}>Gestion des abonnements et facturation</td><td style={S.td}>Exécution du contrat</td></tr>
            <tr><td style={S.td}>Sécurité et prévention des fraudes</td><td style={S.td}>Intérêt légitime</td></tr>
            <tr><td style={S.td}>Journal d&apos;audit (traçabilité)</td><td style={S.td}>Obligation légale / Intérêt légitime</td></tr>
            <tr><td style={S.td}>Support client</td><td style={S.td}>Exécution du contrat</td></tr>
            <tr><td style={S.td}>Communications relatives au Service</td><td style={S.td}>Intérêt légitime</td></tr>
          </tbody>
        </table>

        <h2 style={S.h2}>4. Hébergement et transferts de données</h2>
        <p style={S.p}>
          Les données sont hébergées par <strong style={{ color: "#f0f2f7" }}>Supabase</strong> (serveurs en Allemagne, Union Européenne)
          et <strong style={{ color: "#f0f2f7" }}>Vercel</strong> (CDN global, données de traitement en UE). Ces prestataires
          sont liés à M3A Solutions par des Accords de Traitement des Données (DPA) conformes au RGPD.
        </p>
        <p style={S.p}>
          Les données de monitoring des erreurs sont traitées par <strong style={{ color: "#f0f2f7" }}>Sentry</strong>
          (serveur EU — Allemagne). Aucune donnée personnelle identifiable n&apos;est transmise à Sentry au-delà des logs
          d&apos;erreurs techniques.
        </p>
        <p style={S.p}>
          Aucun transfert de données hors Union Européenne n&apos;est effectué sans garanties appropriées.
        </p>

        <h2 style={S.h2}>5. Durée de conservation</h2>
        <table style={S.table}>
          <thead>
            <tr><th style={S.th}>Type de données</th><th style={S.th}>Durée</th></tr>
          </thead>
          <tbody>
            <tr><td style={S.td}>Données de compte actif</td><td style={S.td}>Durée de l&apos;abonnement</td></tr>
            <tr><td style={S.td}>Données après résiliation</td><td style={S.td}>30 jours (puis suppression)</td></tr>
            <tr><td style={S.td}>Logs d&apos;audit</td><td style={S.td}>12 mois</td></tr>
            <tr><td style={S.td}>Documents KYC</td><td style={S.td}>Durée légale applicable (max 5 ans)</td></tr>
            <tr><td style={S.td}>Données de paiement (référence)</td><td style={S.td}>5 ans (obligation comptable)</td></tr>
          </tbody>
        </table>

        <h2 style={S.h2}>6. Droits des personnes concernées</h2>
        <p style={S.p}>
          Conformément à la loi n° 2008-12 du 25 janvier 2008 sur la Protection des Données à Caractère Personnel
          au Sénégal et au RGPD (applicable aux données traitées en UE), vous disposez des droits suivants :
        </p>
        <ul style={{ paddingLeft: 20, margin: "0 0 12px" }}>
          <li style={S.li}><strong style={{ color: "#f0f2f7" }}>Droit d&apos;accès</strong> : obtenir une copie de vos données.</li>
          <li style={S.li}><strong style={{ color: "#f0f2f7" }}>Droit de rectification</strong> : corriger des données inexactes.</li>
          <li style={S.li}><strong style={{ color: "#f0f2f7" }}>Droit à l&apos;effacement</strong> : demander la suppression de vos données.</li>
          <li style={S.li}><strong style={{ color: "#f0f2f7" }}>Droit à la portabilité</strong> : recevoir vos données dans un format standard.</li>
          <li style={S.li}><strong style={{ color: "#f0f2f7" }}>Droit d&apos;opposition</strong> : vous opposer à certains traitements.</li>
          <li style={S.li}><strong style={{ color: "#f0f2f7" }}>Droit à la limitation</strong> : demander la suspension d&apos;un traitement.</li>
        </ul>
        <p style={S.p}>
          Pour exercer ces droits : <a href={`mailto:${PRIVACY_EMAIL}`} style={{ color: "#f5a623" }}>{PRIVACY_EMAIL}</a>.
          Nous répondrons dans un délai de 30 jours.
        </p>

        <h2 style={S.h2}>7. Sécurité</h2>
        <p style={S.p}>
          M3A Solutions met en œuvre des mesures techniques et organisationnelles adaptées pour protéger vos données :
        </p>
        <ul style={{ paddingLeft: 20, margin: "0 0 12px" }}>
          <li style={S.li}>Chiffrement des communications (TLS/HTTPS)</li>
          <li style={S.li}>Isolation des données par tenant (Row Level Security PostgreSQL)</li>
          <li style={S.li}>Authentification sécurisée (Supabase Auth)</li>
          <li style={S.li}>Journal d&apos;audit de toutes les actions sensibles</li>
          <li style={S.li}>Sauvegardes automatiques de la base de données</li>
          <li style={S.li}>Monitoring des erreurs et alertes (Sentry)</li>
        </ul>

        <h2 style={S.h2}>8. Cookies</h2>
        <p style={S.p}>
          Le Service utilise uniquement des cookies de session strictement nécessaires à l&apos;authentification et au
          fonctionnement de l&apos;application. Aucun cookie publicitaire ou de tracking tiers n&apos;est utilisé.
        </p>

        <h2 style={S.h2}>9. Modifications</h2>
        <p style={S.p}>
          Cette politique peut être mise à jour. En cas de modification substantielle, le Client sera notifié par email
          avec un préavis de 30 jours. La date de dernière mise à jour est indiquée en en-tête du document.
        </p>

        <div style={{ borderTop: "1px solid #2a3147", marginTop: 40, paddingTop: 20, display: "flex", gap: 16, flexWrap: "wrap" }}>
          <Link href="/legal/cgu" style={{ color: "#f5a623", fontSize: 13 }}>Conditions Générales d&apos;Utilisation →</Link>
          <Link href="/register" style={{ color: "#6b7280", fontSize: 13 }}>Créer un compte</Link>
        </div>

      </div>
    </div>
  );
}
