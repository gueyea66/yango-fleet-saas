"use client";
import { useEffect, useState } from "react";

/**
 * Bascule clair/sombre (retour Abdou 04/09). Préférence par appareil
 * (localStorage "m3a-theme"), appliquée via data-theme sur <html> — le script
 * inline du layout la pose avant le premier rendu (pas de flash). Défaut : sombre.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("m3a-theme");
      if (saved === "light") setTheme("light");
    } catch { /* stockage indisponible → sombre */ }
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem("m3a-theme", next); } catch { /* best-effort */ }
    if (next === "light") document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
  };

  return (
    <button onClick={toggle} title={theme === "dark" ? "Passer en mode clair" : "Passer en mode sombre"}
      style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 8px", color: "var(--sk-t2)", fontSize: 16, lineHeight: 1 }}>
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}
