#!/usr/bin/env node
// Runs supabase/migrations/*.sql against the live database as part of
// `npm run build`, so schema and code always deploy together — see
// docs/stan-projektu.md section 6 for the production outage this replaces
// (manual SQL Editor paste, easy to forget or run out of order).
//
// SUPABASE_DB_URL not set: warn and continue. Vercel builds without it
// configured yet must not start failing outright — that would be worse than
// the manual-paste problem it's meant to fix. Once it's set, a real
// migration failure DOES fail the build, on purpose: deploying app code
// against a schema that didn't actually update is exactly the bug this
// script exists to prevent.
import { spawnSync } from "node:child_process";

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.warn(
    "[migrate-db] SUPABASE_DB_URL is not set - skipping automatic schema " +
      "migration. Set it in Vercel (Project Settings > Environment " +
      "Variables) with the Postgres connection string from Supabase " +
      "Dashboard > Project Settings > Database > Connection string > URI " +
      "to enable this step.",
  );
  process.exit(0);
}

const result = spawnSync(
  "npx",
  ["supabase", "db", "push", "--db-url", dbUrl, "--include-all", "--yes"],
  { stdio: "inherit", shell: true },
);

if (result.status !== 0) {
  console.error(
    "[migrate-db] Migration failed - aborting build so the app never " +
      "deploys against a database that didn't actually update.",
  );
  process.exit(result.status ?? 1);
}
