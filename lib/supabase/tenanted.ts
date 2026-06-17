"use client";

import { createClient } from "@/lib/supabase/client";
import { loadTenantContext } from "@/lib/tenant/loader";

let tenantId: string | null = null;

export async function getTenantId(): Promise<string> {
  if (tenantId) return tenantId;
  const ctx = await loadTenantContext();
  tenantId = ctx.tenant.id;
  return tenantId;
}

export function clearTenantId() {
  tenantId = null;
}

// Returns a supabase query builder pre-filtered by tenant_id
export async function tenantedFrom(table: string) {
  const supabase = createClient() as any;
  const tid = await getTenantId();
  return {
    select: (cols = "*") => supabase.from(table).select(cols).eq("tenant_id", tid),
    insert: (data: Record<string, unknown> | Record<string, unknown>[]) => {
      const rows = Array.isArray(data) ? data : [data];
      const withTenant = rows.map((r) => ({ ...r, tenant_id: tid }));
      return supabase.from(table).insert(withTenant);
    },
    update: (data: Record<string, unknown>) =>
      supabase.from(table).update(data).eq("tenant_id", tid),
    upsert: (data: Record<string, unknown> | Record<string, unknown>[]) => {
      const rows = Array.isArray(data) ? data : [data];
      const withTenant = rows.map((r) => ({ ...r, tenant_id: tid }));
      return supabase.from(table).upsert(withTenant);
    },
    raw: () => supabase.from(table),
    tenantId: tid,
  };
}
