import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  // Vitrine servie statiquement (TTFB) : la redirection des sous-domaines
  // clients (slug.m3afleet.com/ → login) vit ici, plus dans app/page.tsx —
  // la home n'a plus besoin de headers() et sort du rendu dynamique.
  const { pathname } = request.nextUrl;
  if (pathname === "/") {
    const hostname = (request.headers.get("host") || "").split(":")[0];
    const parts = hostname.split(".");
    if (parts.length >= 3 && parts[0] !== "www" && hostname !== "localhost") {
      const url = request.nextUrl.clone();
      url.pathname = "/auth/login";
      return Response.redirect(url, 307);
    }
  }
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    "/((?!_next/static|_next/image|favicon.ico|public).*)",
  ],
};
