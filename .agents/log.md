# Agent handoff log

See AGENTS.md for how to use this file.

## 2026-08-01 — Claude — GCP setup, WIF auth fix, event time extraction, merged Codex's branch

- Set up Document AI + Route Optimization from scratch on a new GCP project (`logical-vault-503917-r9`), both via Vercel OIDC Workload Identity Federation (no service account key, no API key).
- Fixed the WIF principal binding format: `google.subject=assertion.sub` mapping requires `principal://.../workloadIdentityPools/POOL/subject/VALUE` (singular, `/subject/`), not `principalSet://.../attribute.sub/VALUE` — the latter silently never matches anything since there's no custom `attribute.sub`, only the built-in `google.subject`.
- Route Optimization API rejects API keys outright (`UNAUTHENTICATED`/`CREDENTIALS_MISSING` — confirmed via direct curl test). Switched `src/app/api/routes/optimize/route.ts` to the same WIF client as Document AI (extracted to `src/lib/gcp-oidc.ts`). Needed `roles/routeoptimization.editor` (not `.viewer` — viewer lacks `routeoptimization.locations.use` despite what Google's own IAM docs summary implies).
- Fixed 3 payload bugs surfaced only by hitting the real API: `vehicles[].startLocation` can't carry an `address` field (Google rejects unknown fields), the URL must NOT include `/locations/global` (unsupported, location segment is optional), and `globalStartTime`/`globalEndTime` must have zero nanos (`Date.toISOString()` always includes millis — stripped via regex).
- Added event-time extraction in `mandate-ocr.ts`: `dateNear(..., withTime=true)` now also looks for a `godz. HH:MM` pattern in the same context window and folds it into a full ISO datetime, so `matchVehicleCustomer` can tell apart two same-day handovers of one vehicle. Also fixed a pre-existing regex bug: the date pattern's trailing `\b` never matches when a letter immediately follows the year with no space (`15.07.2026r.` — very common in Polish official docs) since digit and letter are both `\w`; switched to `(?<!\d)...(?!\d)`.
- Migrated `mandate_documents.event_at` from `date` to `timestamptz` in `supabase/schema.sql` **and already ran the `ALTER COLUMN` on the live Supabase DB** — this is done, not just in the schema file.
- Merged `codex/api-diagnostics-hardening` into `main` (commit `4b095f6`) — clean merge, no file-level overlap with the above (verified via `git diff --stat` per-commit before merging). Brings in: camera-upload fix (root cause of "photos won't upload" — iOS/Android camera captures often lack a filename extension, and the old check only looked at the extension), audit log, OCR retry queue (`claim_ocr_job` RPC + `/api/internal/ocr/process`, gated by `CRON_SECRET`), payment notice PDF, `/api/health`, security headers.
- **Still needed for the OCR retry queue to actually run**: `CRON_SECRET` env var isn't set in Vercel yet, and there's no Vercel Cron Job configured to hit `/api/internal/ocr/process` on a schedule. Whoever picks this up next should set that up (or confirm Filip doesn't want it yet).
- `GOOGLE_MAPS_SERVER_API_KEY` env var in Vercel is now dead/unused — safe to delete, not required by the new WIF-based Route Optimization path.

## 2026-08-01 — Claude — Fixed wrong plate extraction (car model matched instead of "nr rej.")

- Real scanned document ("BMWE36" case) showed registration number extracted as `BMWE36` and no vehicle match, even though the letter clearly states `nr rej. WX 12345` a few lines below `BMW E36` (the vehicle model).
- Root cause: the plate label regex in `extractMandateFields` only matched the fully spelled-out "rejestracyjny/nego/nym" — real letters almost always abbreviate to "nr rej.", so the label regex never matched, and extraction silently fell through to the whole-text fallback scan, which grabs the *first* capitalized alnum-with-digit token anywhere in the text. That's the car model/chassis code ("BMW E36") mentioned earlier in the letter, not the actual plate.
- Fixed by accepting `rej\.` as an alternative to the full word in the label stem. Verified against the real document text — now correctly extracts `WX12345`.
- If you see other mismatched-plate cases, check whether the label pattern (`nr|numer ... rej.|rejestracyjny...`) actually appears in that document's OCR text before assuming it's a Document AI accuracy issue — it might just be a label phrasing the regex doesn't recognize yet.
