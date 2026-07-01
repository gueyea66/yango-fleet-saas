import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdminAuth } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

// GET — list notifications for current user
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAdminAuth();
    const { searchParams } = new URL(req.url);
    const limit = Math.min(50, parseInt(searchParams.get("limit") || "20"));
    const unreadOnly = searchParams.get("unread") === "1";

    let q = admin
      .from("notifications")
      .select("*")
      .eq("recipient_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (unreadOnly) q = q.is("read_at", null);

    const { data, error } = await q;
    if (error) throw error;

    const { count } = await admin
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("recipient_id", userId)
      .is("read_at", null);

    return NextResponse.json({ notifications: data ?? [], unreadCount: count ?? 0 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}

// PATCH — mark one notification as read
export async function PATCH(req: NextRequest) {
  try {
    const { userId } = await requireAdminAuth();
    const { id, markAll } = await req.json();

    if (markAll) {
      await admin
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("recipient_id", userId)
        .is("read_at", null);
    } else if (id) {
      await admin
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id)
        .eq("recipient_id", userId);
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}
