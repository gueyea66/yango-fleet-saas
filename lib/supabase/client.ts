import { createBrowserClient } from "@supabase/ssr";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let instance: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const createClient = (): any => {
  if (!instance) {
    instance = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { db: { schema: "fleet" } } as any
    );
  }
  return instance;
};

export const clearClient = () => {
  instance = null;
};
