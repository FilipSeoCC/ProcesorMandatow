import "server-only";
import { ExternalAccountClient } from "google-auth-library";
import { getVercelOidcToken } from "@vercel/oidc";

// Vercel OIDC federation: exchanges VERCEL_OIDC_TOKEN for a short-lived GCP
// access token via Workload Identity Federation. No service account key
// involved (blocked by org policy iam.disableServiceAccountKeyCreation).
export function gcpWorkloadIdentityClient(audience: string) {
  const client = ExternalAccountClient.fromJSON({
    type: "external_account",
    audience,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_url: "https://sts.googleapis.com/v1/token",
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    subject_token_supplier: {
      getSubjectToken: async () => {
        const token = await getVercelOidcToken();
        if (!token) throw new Error("VERCEL_OIDC_TOKEN missing");
        return token;
      },
    },
  });
  if (!client) throw new Error("GCP_WIF_CONFIG_INVALID");
  return client;
}
