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
  amountGross: string;
  currency: string;
  paymentDueAt: string;
  responseDueAt: string;
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

type FinancialRow = {
  amount_gross: string | number | null;
  currency: string | null;
  payment_due_at: string | null;
  response_due_at: string | null;
};

const normalizePlate = (value: string) =>
  value.replace(/[\s-]/g, "").toUpperCase();

async function fetchRows<T>(endpoint: string, secretKey: string) {
  const response = await fetch(endpoint, {
    headers: adminHeaders(secretKey),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `AUTHORITY_CONTEXT_${response.status}:${detail.slice(0, 300)}`,
    );
  }
  return (await response.json()) as T[];
}

async function fetchOptionalRows<T>(
  endpoint: string,
  secretKey: string,
  label: string,
) {
  try {
    return await fetchRows<T>(endpoint, secretKey);
  } catch (error) {
    // Optional profile/financial fields are introduced by later schema
    // migrations. They must not make the core PDF route unavailable.
    console.warn(`Optional authority context unavailable: ${label}`, error);
    return [];
  }
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
  // Keep the required query limited to columns used by the original MVP.
  // New finance/profile columns are loaded independently and may be absent.
  const documents = await fetchRows<DocumentRow>(
    `${url}/rest/v1/mandate_documents?select=case_number,registration_number,event_at,letter_date,sender,responsible_name,responsible_tax_id,responsible_email,confirmed_at&id=eq.${encodeURIComponent(documentId)}&organization_id=eq.${member.organizationId}&limit=1`,
    secretKey,
  );
  const document = documents[0];
  if (!document) return null;

  const [organizations, organizationDetails, memberships, vehicles, finances] =
    await Promise.all([
      fetchRows<{ name: string }>(
        `${url}/rest/v1/organizations?select=name&id=eq.${member.organizationId}&limit=1`,
        secretKey,
      ),
      fetchOptionalRows<{
        postal_address: string;
        contact_email: string;
        contact_phone: string;
      }>(
        `${url}/rest/v1/organizations?select=postal_address,contact_email,contact_phone&id=eq.${member.organizationId}&limit=1`,
        secretKey,
        "organization_contact",
      ),
      fetchOptionalRows<{
        display_name: string;
        role: VerifiedMember["role"];
      }>(
        `${url}/rest/v1/organization_members?select=display_name,role&organization_id=eq.${member.organizationId}&user_id=eq.${member.userId}&limit=1`,
        secretKey,
        "member_profile",
      ),
      fetchRows<{
        id: string;
        brand: string;
        model: string;
        registration_number: string;
      }>(
        `${url}/rest/v1/vehicles?select=id,brand,model,registration_number&organization_id=eq.${member.organizationId}`,
        secretKey,
      ),
      fetchOptionalRows<FinancialRow>(
        `${url}/rest/v1/mandate_documents?select=amount_gross,currency,payment_due_at,response_due_at&id=eq.${encodeURIComponent(documentId)}&organization_id=eq.${member.organizationId}&limit=1`,
        secretKey,
        "document_financials",
      ),
    ]);

  const organization = organizations[0];
  const organizationDetail = organizationDetails[0];
  const membership = memberships[0];
  const financial = finances[0];
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
    const assignments = await fetchOptionalRows<{
      id: string;
      customer_id: string;
    }>(
      `${url}/rest/v1/vehicle_assignments?select=id,customer_id&organization_id=eq.${member.organizationId}&vehicle_id=eq.${vehicle.id}&valid_from=lte.${eventAt}&or=(valid_to.is.null,valid_to.gt.${eventAt})&order=valid_from.desc&limit=1`,
      secretKey,
      "vehicle_assignment",
    );
    const assignment = assignments[0];
    if (assignment) {
      const [customers, agreementRows, customerAddresses] = await Promise.all([
        fetchOptionalRows<{ name: string; tax_id: string; email: string }>(
          `${url}/rest/v1/customers?select=name,tax_id,email&organization_id=eq.${member.organizationId}&id=eq.${assignment.customer_id}&limit=1`,
          secretKey,
          "customer_core",
        ),
        fetchOptionalRows<{ agreement_number: string }>(
          `${url}/rest/v1/vehicle_assignments?select=agreement_number&organization_id=eq.${member.organizationId}&id=eq.${assignment.id}&limit=1`,
          secretKey,
          "assignment_agreement",
        ),
        fetchOptionalRows<{ address: string }>(
          `${url}/rest/v1/customers?select=address&organization_id=eq.${member.organizationId}&id=eq.${assignment.customer_id}&limit=1`,
          secretKey,
          "customer_address",
        ),
      ]);
      const customerCore = customers[0];
      agreementNumber = agreementRows[0]?.agreement_number ?? "";
      if (customerCore) {
        customer = {
          ...customerCore,
          address: customerAddresses[0]?.address ?? "",
        };
      }
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
    organizationAddress: organizationDetail?.postal_address || "",
    organizationEmail: organizationDetail?.contact_email || "",
    organizationPhone: organizationDetail?.contact_phone || "",
    signerName:
      membership?.display_name?.trim() ||
      metadataName ||
      member.email ||
      "Osoba upoważniona",
    signerPosition: positionLabel(membership?.role || member.role),
    confirmedAt: document.confirmed_at ?? "",
    amountGross:
      financial?.amount_gross === null ||
      financial?.amount_gross === undefined
        ? ""
        : String(financial.amount_gross),
    currency: financial?.currency ?? "PLN",
    paymentDueAt: financial?.payment_due_at ?? "",
    responseDueAt: financial?.response_due_at ?? "",
  };
}
