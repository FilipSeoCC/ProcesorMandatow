import "server-only";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";

type AuditEvent = {
  organizationId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  details?: Record<string, unknown>;
};

export async function writeAuditEvent(event: AuditEvent) {
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey) return;

  const response = await fetch(`${url}/rest/v1/audit_events`, {
    method: "POST",
    headers: {
      ...adminHeaders(secretKey),
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      organization_id: event.organizationId,
      user_id: event.userId,
      action: event.action,
      entity_type: event.entityType,
      entity_id: event.entityId,
      details: event.details ?? {},
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) console.error("Audit event failed", response.status);
}
