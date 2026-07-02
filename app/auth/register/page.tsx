import { redirect } from "next/navigation";

// Legacy — l'inscription passe par l'onboarding self-service /register
// (créait un compte Supabase orphelin sans tenant ni profil)
export default function LegacyRegisterRedirect() {
  redirect("/register");
}
