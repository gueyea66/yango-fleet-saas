import type { MetadataRoute } from "next";

// SEO (audit 02/09) : robots + sitemap — l'app privée reste hors index.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/driver", "/superadmin", "/api/", "/auth/", "/locked", "/paiement"],
      },
    ],
    sitemap: "https://m3afleet.com/sitemap.xml",
  };
}
