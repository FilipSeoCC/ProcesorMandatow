import "server-only";
import { ExternalAccountClient } from "google-auth-library";
import { getVercelOidcToken } from "@vercel/oidc";

function workloadIdentityConfig() {
  const audience = process.env.GOOGLE_WIF_AUDIENCE;
  const serviceAccountEmail =
    process.env.GOOGLE_WIF_SERVICE_ACCOUNT_EMAIL ||
    process.env.GCP_SERVICE_ACCOUNT_EMAIL;

  if (!audience || !serviceAccountEmail) return null;
  return { audience, serviceAccountEmail };
}

export function hasGoogleWorkloadIdentity() {
  return Boolean(workloadIdentityConfig());
}

export async function getGoogleCloudAccessToken() {
  const config = workloadIdentityConfig();
  if (!config) throw new Error("GOOGLE_WIF_NOT_CONFIGURED");

  const client = ExternalAccountClient.fromJSON({
    type: "external_account",
    audience: config.audience,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_url: "https://sts.googleapis.com/v1/token",
    service_account_impersonation_url:
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(config.serviceAccountEmail)}:generateAccessToken`,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    subject_token_supplier: {
      getSubjectToken: async () => getVercelOidcToken(),
    },
  });

  if (!client) throw new Error("GOOGLE_WIF_CONFIG_INVALID");
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("GOOGLE_WIF_AUTH_FAILED");
  return token;
}
