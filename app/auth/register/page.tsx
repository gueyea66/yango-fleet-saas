"use client";

export const dynamic = "force-dynamic";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
          },
        },
      });

      if (signUpError) {
        setError(signUpError.message);
      } else {
        router.push("/auth/login?message=Veuillez%20vérifier%20votre%20email");
      }
    } catch (err) {
      setError("Une erreur est survenue");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 px-4">
      <div className="w-full max-w-md">
        <div className="bg-gray-800 rounded-lg p-8 shadow-xl">
          <div className="flex justify-center mb-6">
            <div className="w-12 h-12 bg-yellow-500 rounded-lg flex items-center justify-center text-black font-bold text-xl">
              Y
            </div>
          </div>

          <h1 className="text-2xl font-bold text-center text-white mb-2">
            Yango Fleet
          </h1>
          <p className="text-center text-gray-400 text-sm mb-8">
            Créer un compte conducteur
          </p>

          {error && (
            <div className="bg-red-900 bg-opacity-30 border border-red-600 rounded px-4 py-3 mb-6 text-red-300 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs uppercase font-semibold text-gray-400 block mb-2">
                Nom complet
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:border-yellow-500 transition"
                placeholder="Moussa Diallo"
                required
              />
            </div>

            <div>
              <label className="text-xs uppercase font-semibold text-gray-400 block mb-2">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:border-yellow-500 transition"
                placeholder="moussa@email.com"
                required
              />
            </div>

            <div>
              <label className="text-xs uppercase font-semibold text-gray-400 block mb-2">
                Mot de passe
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:border-yellow-500 transition"
                placeholder="••••••••"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-yellow-500 hover:bg-yellow-600 disabled:opacity-50 text-black font-semibold py-3 rounded transition mt-6"
            >
              {loading ? "Création..." : "Créer un compte"}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-gray-400">
            Vous avez déjà un compte ?{" "}
            <Link href="/auth/login" className="text-yellow-500 hover:text-yellow-400">
              Se connecter
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
