import { redirect } from "next/navigation";

// La racine renvoie vers la connexion — le branding tenant s'applique sur /auth/login
export default function Home() {
  redirect("/auth/login");
}
