import "server-only";

function first(...values: Array<string | undefined>) {
  return values.find((value) => value?.trim())?.trim() ?? null;
}

export function getSupabaseServerEnv() {
  const url = first(process.env.SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_URL);
  const publishableKey = first(
    process.env.SUPABASE_PUBLISHABLE_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    process.env.SUPABASE_ANON_KEY,
  );
  const secretKey = first(process.env.SUPABASE_SECRET_KEY, process.env.SUPABASE_SERVICE_ROLE_KEY);
  return { url, publishableKey, secretKey };
}

export function adminHeaders(secretKey: string) {
  return {
    apikey: secretKey,
    ...(secretKey.startsWith("eyJ") ? { Authorization: `Bearer ${secretKey}` } : {}),
  };
}
