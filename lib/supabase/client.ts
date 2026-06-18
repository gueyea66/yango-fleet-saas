import { createClient as createSupabaseClient, SupabaseClient } from "@supabase/supabase-js";

let instance: SupabaseClient | null = null;

export const createClient = (): SupabaseClient => {
  if (!instance) {
    instance = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        db: { schema: "fleet" },
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      }
    );
  }
  return instance;
};

export const clearClient = () => {
  instance = null;
};
