import "server-only";
import type { VerifiedMember } from "@/lib/supabase-auth";
import { adminHeaders } from "@/lib/supabase-env";

export type AuthorityContext = {
  documentId: string;
  caseNumber: string;
  registrationNumber: string;
  eventAt: string;
  letterDate: string;
  sender: string;
  responsibleName: string;
  responsibleTaxId: string;
  responsibleEmail: string;
  responsibleAddress: string;
  vehicleBrand: string;
  vehicleModel: string;
  agreementNumber: string;
  organizationName: string;
  organizationAddress: string;
  organizationEmail: string;
  organizationPhone: string;
  signerName: string;
  signerPosition: string;
  confirmedAt: string;
};

type DocumentRow = {
  case_number: string | null;
  registration_number: string | null;
  event_at: string | null;
  letter_date: string | null;
  sender: string | null;
  responsible_name: string;
  responsible_tax_id: string;
  responsible_email: string;
  confirmed_at: string | null;
};

const normalizePlate = (value: string) =>
  value.replace(/[\s-]/g, "").toUpperCase();

async function fetchRows<T>(url: string, secretKey: string) {
  const response = await fetch(url, {
    headers: adminHeaders(secretKey),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`AUTHORITY_CONTEXT_${response.status}`);
  return (await response.json()) as T[];
}

function positionLabel(role: VerifiedMember["role"]) {
  if (role === "admin") return "Osoba upoważniona / Administrator floty";
  return "Pracownik Biura Obsługi Floty";
}

export async function loadAuthorityContext(
  url: string,
  secretKey: string,
  member: VerifiedMember,
  documentId: string,
): Promise<AuthorityContext | null> {
  const documents = await fetchRows<DocumentRow>(
    `${url}/rest/v1/mandate_documents?select=case_number,registration_number,event_at,letter_date,sender,responsible_name,responsible_tax_id,responsible_email,confirmed_at&id=eq.${encodeURIComponent(documentId)}&organization_id=eq.${member.organizationId}&limit=1`,
    secretKey,
  );
  const document = documents[0];
  if (!document) return null;

  const [organizations, memberships, vehicles] = await Promise.all([
    fetchRows<{
      name: string;
      postal_address: string;
      contact_email: string;
      contact_phone: string;
    }>(
      `${url}/rest/v1/organizations?select=name,postal_address,contact_email,contact_phone&id=eq.${member.organizationId}&limit=1`,
      secretKey,
    ),
    fetchRows<{ display_name: string; role: VerifiedMember["role"] }>(
      `${url}/rest/v1/organization_members?select=display_name,role&organization_id=eq.${member.organizationId}&user_id=eq.${member.userId}&limit=1`,
      secretKey,
    ),
    fetchRows<{ id: string; brand: string; model: string; registration_number: string }>(
      `${url}/rest/v1/vehicles?select=id,brand,model,registration_number&organization_id=eq.${member.organizationId}`,
      secretKey,
    ),
  ]);

  const organization = organizations[0];
  const membership = memberships[0];
  const vehicle = vehicles.find(
    (item) =>
      normalizePlate(item.registration_number) ===
      normalizePlate(document.registration_number ?? ""),
  );

  let agreementNumber = "";
  let customer: {
    name: string;
    tax_id: string;
    email: string;
    address: string;
  } | null = null;

  if (vehicle && document.event_at) {
    const eventAt = encodeURIComponent(document.event_at);
    const assignments = await fetchRows<{
      customer_id: string;
      agreement_number: string;
    }>(
      `${url}/rest/v1/vehicle_assignments?select=customer_id,agreement_number&organization_id=eq.${member.organizationId}&vehicle_id=eq.${vehicle.id}&valid_from=lte.${eventAt}&or=(valid_to.is.null,valid_to.gt.${eventAt})&order=valid_from.desc&limit=1`,
      secretKey,
    );
    const assignment = assignments[0];
    if (assignment) {
      agreementNumber = assignment.agreement_number;
      const customers = await fetchRows<{
        name: string;
        tax_id: string;
        email: string;
        address: string;
      }>(
        `${url}/rest/v1/customers?select=name,tax_id,email,address&organization_id=eq.${member.organizationId}&id=eq.${assignment.customer_id}&limit=1`,
        secretKey,
      );
      customer = customers[0] ?? null;
    }
  }

  const metadataName = [member.firstName, member.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();

  return {
    documentId,
    caseNumber: document.case_number ?? "",
    registrationNumber: document.registration_number ?? "",
    eventAt: document.event_at ?? "",
    letterDate: document.letter_date ?? "",
    sender: document.sender ?? "",
    responsibleName: customer?.name || document.responsible_name,
    responsibleTaxId: customer?.tax_id || document.responsible_tax_id,
    responsibleEmail: customer?.email || document.responsible_email,
    responsibleAddress: customer?.address || "",
    vehicleBrand: vehicle?.brand ?? "",
    vehicleModel: vehicle?.model ?? "",
    agreementNumber,
    organizationName: organization?.name || "FlotaFlow",
    organizationAddress: organization?.postal_address || "",
    organizationEmail: organization?.contact_email || "",
    organizationPhone: organization?.contact_phone || "",
    signerName:
      membership?.display_name?.trim() || metadataName || member.email || "Osoba upoważniona",
    signerPosition: positionLabel(membership?.role || member.role),
    confirmedAt: document.confirmed_at ?? "",
  };
}
