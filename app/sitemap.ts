import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://m3afleet.com";
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/register`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/legal/confidentialite`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/legal/cgu`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
