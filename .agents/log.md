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
- ~~`GOOGLE_MAPS_SERVER_API_KEY` env var in Vercel is now dead/unused — safe to delete, not required by the new WIF-based Route Optimization path.~~ **WRONG — corrected 2026-08-02.** Only *Route Optimization* moved to WIF. `/api/routes/geocode` is still the sole consumer of `GOOGLE_MAPS_SERVER_API_KEY` (classic Maps Geocoding API, API-key auth) and returns 503 "Geokodowanie nie jest skonfigurowane" without it — which kills the route planner at step one, since you cannot add a single address. Do not delete that env var. It is also missing from `.env.example`, so nothing documents that it is still required.

## 2026-08-01 — Claude — Fixed wrong plate extraction (car model matched instead of "nr rej.")

- Real scanned document ("BMWE36" case) showed registration number extracted as `BMWE36` and no vehicle match, even though the letter clearly states `nr rej. WX 12345` a few lines below `BMW E36` (the vehicle model).
- Root cause: the plate label regex in `extractMandateFields` only matched the fully spelled-out "rejestracyjny/nego/nym" — real letters almost always abbreviate to "nr rej.", so the label regex never matched, and extraction silently fell through to the whole-text fallback scan, which grabs the *first* capitalized alnum-with-digit token anywhere in the text. That's the car model/chassis code ("BMW E36") mentioned earlier in the letter, not the actual plate.
- Fixed by accepting `rej\.` as an alternative to the full word in the label stem. Verified against the real document text — now correctly extracts `WX12345`.
- If you see other mismatched-plate cases, check whether the label pattern (`nr|numer ... rej.|rejestracyjny...`) actually appears in that document's OCR text before assuming it's a Document AI accuracy issue — it might just be a label phrasing the regex doesn't recognize yet.

## 2026-08-01 — Claude — Plausibility checks for match inputs + tabular time-extraction fix

- Added `plausiblePlate` and `plausibleEventDate` in `mandate-ocr.ts`: loose sanity checks (not hard validation — Filip was explicit vanity plates and genuinely old cases must still pass) used to (a) prefer a plate-shaped candidate in the fallback scan and (b) lower the field's confidence score, surfaced to the reviewer, when the value doesn't look plausible. Plate: starts with a letter, 4-8 chars, A-Z0-9 only, no hardcoded region-code list. Event date: only an upper bound (can't be in the future — a misread digit swap produces exactly that); no lower bound, since a mandate case can legitimately be old.
- Separately found and fixed: the time regex only matched inline phrasing like "o godz. 14:32" — real doc (WI2847K case) has a tabular layout, "Godzina zdarzenia" as its own label with the value on the next line, which the old tight pattern couldn't reach. Widened the label-to-digits gap tolerance to 30 chars.
- **Open question from Filip, not yet built**: automatic re-match retry when a vehicle/customer is added to the fleet *after* a document's OCR already ran and failed to match (currently: matching only runs once, right after OCR; adding the vehicle later requires the reviewer to manually click "Zmień dopasowanie"). If you're picking this up, check with Filip on scope first — could be a scheduled sweep of `needs_review` docs with no match, similar to the existing `claim_ocr_job` retry-queue pattern.

## 2026-08-01 — Claude — Built the auto-rematch sweep, added vercel.json crons, name plausibility check

- Built the auto-rematch feature from the open question above: `src/app/api/internal/documents/rematch/route.ts` (CRON_SECRET-gated, same auth pattern as `/api/internal/ocr/process`). No claiming/backoff — plain DB reads, idempotent, safe to overlap.
- Added `vercel.json` with daily cron schedules for **both** this and the existing OCR retry queue — neither had an actual trigger configured before this (I'd flagged the OCR queue's missing trigger in an earlier log entry). Note: Vercel Hobby plan hard-rejects any cron schedule more frequent than once/day — confirmed via Vercel's own docs, don't try to tighten these without checking Filip's plan tier first.
- **`CRON_SECRET` env var still isn't set in Vercel** — both cron endpoints 401 until it is. This blocks both the OCR retry queue and the new rematch sweep from doing anything.
- Added `plausibleName` in `workspace.tsx` (client-side), same soft-signal pattern as the OCR plate/date checks — flags the manually-edited "Nazwa / imię i nazwisko" field via the existing `warning` style when it doesn't look like a name (digits, single char, stray symbols), without rejecting real Polish names/diacritics/hyphenated surnames/company names. This field is manually entered or comes from the DB match, never from OCR — no OCR-side name extraction exists or is planned (documents don't contain the renter's name, that's the whole reason plate+date matching exists).

## 2026-08-01 — Claude — Frontend for "send review package to employee" (Filip: Claude=frontend, Codex=backend)

Filip asked for this split explicitly: I built the frontend in `workspace.tsx` against the contract below; **the backend endpoint doesn't exist yet** — that's Codex's part, per Filip's own message describing the flow (OCR done → matched client → employee gets a ready-to-forward client email + original scan, employee reviews and forwards manually, system never emails the client directly).

**Frontend contract I built against** (adjust and tell me here if this needs to change):
- `POST /api/documents/{documentId}/send-review-package`
- Request body (optional): `{ "recipientEmail": "someone@firma.pl" }` — omitted when the reviewer leaves the field blank (defaults to `account.email` in the confirm dialog, but they can clear/change it); backend should fall back to `MANDATE_REVIEW_EMAIL` per Codex's own earlier spec if empty.
- Success response: `{ "ok": true, ... }` — frontend doesn't currently read specific fields back beyond `response.ok`, just refetches the document list after (`loadDocuments`), so whatever shape works for you is fine as long as it's `200` on success.
- Error response: `{ "error": "human-readable message" }` with non-2xx status — frontend surfaces `data.error` directly to the user, so make it Polish/user-facing, not a stack trace.
- Expects a `review_package_sent_at` (timestamptz, nullable) column on `mandate_documents`, included in the `select=` of `GET /api/documents` (list) — used to show "Wyślij ponownie" instead of "Wyślij pakiet do pracownika" and a last-sent tooltip. If you name it differently, tell me here and I'll adjust the one line in `workspace.tsx` that reads `document.review_package_sent_at`.

**Frontend gating** (button only appears/enables when ALL of these hold — mirrors Codex's stated criteria, but I additionally gated on `confirmed_at` since this sits right next to the existing "Pobierz wezwanie PDF" button, which already requires it):
- case `confirmed_at` is set (reviewer already clicked "Zatwierdź dane"),
- `registration_number`, `event_at`, `responsible_name`, `responsible_email` all present.
- When any of the last four are missing (rare — confirming without a match), the button is replaced by inline text listing exactly what's missing, not just grayed out.

**UX decisions** (used the `ui-ux-pro-max` skill for this, per Filip's request):
- Real confirmation modal before sending (not a bare click) — this fires an email with a client's PII, so it gets the same weight as other consequential actions in this app. Modal explicitly states "nie bezpośrednio do klienta" (not directly to the client) since that's the exact misunderstanding-risk Filip flagged, and shows a summary (plate/date/matched client) so the reviewer has a last sanity check.
- Recipient email field in the modal is editable, prefilled with the logged-in reviewer's own email — matches the common case (reviewer forwards it themself) while still allowing a different employee's address.
- Reused the existing `.modalLayer`/`.helpModal` CSS classes and structure (same as the help/settings modals) rather than inventing new modal styling, for visual consistency.
- Button copy is intentionally explicit about the mechanism ("Wyślij pakiet do pracownika", not something client-facing-sounding like "Wyślij wezwanie") — the whole point Filip raised is that this must never read as "sends to the client."

Verified: `tsc --noEmit` clean, dev server boots and serves `/` with no console errors. Could not verify the actual button/modal visually — the case-detail view requires a logged-in session and I don't handle credentials.

## 2026-08-01 — Claude — Email content spec from Filip, for Codex's send-review-package backend

Filip refined what the email to the employee should actually contain (this is backend/email-template work — Resend integration, not something the frontend controls):

- **Body tone/opening**: friendly, explicit that this is an automatic match that needs human verification before forwarding — something like: "Cześć, przesyłamy automatyczne dopasowanie mandatu do klienta. Zweryfikuj zeskanowane dane z danymi na wezwaniu, zanim prześlesz je dalej do klienta."
- **Attachment**: the notice ("wezwanie"), already filled in with the matched client's data. **This already exists** — reuse `buildPdf()` / the same generation logic from `src/app/api/documents/[id]/notice/route.ts` (PDFKit, `NotoSans` font, fields: responsible_name, case_number, registration_number, event_at, sender) rather than building a second PDF generator. Don't duplicate that logic.
- **In the email body itself** (not just the PDF): show the raw OCR text (`mandate_documents.ocr_text`) so the reviewer can see exactly what the system read from the original letter, next to what it extracted. Filip's own words: "może być surówka, lekko ustrukturyzowana, żeby wyglądała chociaż jak wezwanie" — i.e. it doesn't need real parsing/formatting, just wrap it reasonably (line breaks preserved, maybe a monospace/`<pre>`-style block in the HTML email) so it's not an unreadable wall of text. Label it clearly as "Treść odczytana z dokumentu (OCR)" or similar, distinct from the structured extracted fields (plate/date/client) which should also be shown as a quick-scan summary above it.
- Otherwise matches what Codex already spec'd earlier in this same conversation: link to the case in the panel, sent to the employee (or `MANDATE_REVIEW_EMAIL` default) — never the client directly.

## 2026-08-01 21:15 — Claude — Bug review + fixes on `main`, plus a coordination gap to flag

Reviewed the diff Codex pushed directly to `main` since my last touch (OCR queue, audit log, `authority-notice`/`authority-package`, `review-package`, access hardening). Found and fixed 3 things, now on `main` (commit `dac1ccc`, rebased on top of `36cd09f`):

- **`src/lib/review-package.ts` — `escapeHtml` only escaped `&`.** Regex was `/&/g` but the replacer map also had entries for `<`, `>`, `"`, `'` — those never matched, so they passed through unescaped into the outbound review-package HTML email. Since `responsible_name`/`sender`/etc. come from OCR (attacker-influenced document content, not typed by an admin), this was a real HTML-injection path into an email your team reads. Fixed the regex to `/[&<>"']/g`.
- **`workspace.tsx` — `prepareCameraUpload()` dropped the user-edited page name.** When the camera-compression refactor landed, the new function stopped reading `page.name` (the "Kliknij nazwę, aby ją zmienić" field) and just used the original camera filename instead. Renaming a scanned page before upload silently did nothing. Restored — `prepareCameraUpload(file, displayName)` now uses the trimmed display name with the right extension in both the compressed and uncompressed path.
- **`.formFooter` overflow on mobile.** That footer can now hold up to 4 things at once (Oznacz jako zrealizowaną / Pobierz wezwanie PDF / Wyślij pakiet do siebie / Zatwierdź dane) with no wrap — on a 375px viewport they clipped/overflowed. Added mobile stacking (`flex-direction: column`, buttons `flex: 1 1 auto`). Also added the missing `gap` on `.helpModal footer` — the send-package modal is the first one to use two footer buttons there, and the base style never needed a gap before (single-button modals only).

**Full findings list** (including 2 not yet fixed — the vehicle-reassignment-overwrites-history bug in `/api/fleet/vehicles` POST, and a non-deterministic `vehicle_assignments` match due to missing `ORDER BY` in `vehicle-match.ts`) is in the code-review I ran this session — not copied here in full, ask Filip or re-run `/code-review` if you want the complete list re-surfaced.

**Coordination gap, please read**: I found a stale, **uncommitted, unpushed** WIP sitting in Filip's local checkout at `C:/temp/ProcesorMandatow` (branch `codex/api-diagnostics-hardening`) — a second, independent implementation of the GCP OIDC token exchange (`src/lib/google-workload-identity.ts`, adds service-account impersonation via `service_account_impersonation_url`). Timestamps show it was abandoned mid-work (~13:06–16:08) right before a *different* implementation of the same thing (`src/lib/gcp-oidc.ts`, no impersonation) landed on `main` at 16:31 in "Switch Route Optimization auth from API key to WIF". If the impersonation approach was actually wanted, it never made it in — worth checking whether `roles/routeoptimization.editor` + Document AI's role are enough without impersonation, or whether that WIP should be finished and merged properly instead of left as dead local files. This is also a live example of the exact problem: two agents doing the same task in parallel without checking this log first. Filip wants a `main` PR-required branch rule set up (I don't have `gh` CLI or a repo-admin API available from my side right now) — if you have the access, consider setting `Require a pull request before merging` on `main` so this stops happening silently.

## 2026-08-01 21:30 — Claude — DECYZJA FILIPA: mobilny "Skaner dokumentów" ODRZUCONY, nie buduj tego

Codex, to jest bezpośrednio do Ciebie — dotyczy planu, który miałeś w trakcie, gdy skończył Ci się limit (odnowienie 2026-08-08 13:02). **Nie wracaj do niego po odnowieniu limitu.**

Plan, który zaproponowałeś (ekran główny „Skaner dokumentów", bezpośrednie uruchamianie tylnego aparatu, dolna nawigacja Skaner + Planer tras, **ukrycie na telefonie spraw / floty / pracowników / administracji**, desktop bez zmian) — Filip go **odrzucił**, zapytany wprost. Wybrał: *„Zostawiamy pełną apkę na mobile"* — telefon ma mieć dostęp do wszystkiego, co desktop; dopracowujemy tylko UX (czcionki, przyciski, przycinanie), nie ukrywamy funkcji.

**Dlaczego to ważne — kontekst, którego mogłeś nie mieć**: dokładnie taki osobny mini-app już w tym repo istniał (`src/app/mobile-capture.tsx` + `mobile-capture.module.css`) i **został usunięty dziś** w commicie `3decb46`. Przez wiele godzin Filip zgłaszał „mobilka nie odzwierciedla desktopu"; przyczyną było to, że trzy bloki `@media` w `workspace.module.css` ukrywały **całą prawdziwą aplikację** na ≤900px, ≤760px i short-landscape, a jedyne, co użytkownik mobilny widział, to właśnie ten uproszczony `MobileCapture`. Usunięcie tych reguł + samego komponentu było fixem, nie regresją. Twój plan odbudowałby dokładnie ten sam stan, od którego uciekaliśmy.

Jeśli kiedykolwiek wróci temat „mobile ma być prostszy" — kierunek do rozważenia to hybryda (skaner jako *pierwszy ekran* na telefonie, ale sprawy/flota/pracownicy nadal dostępne w menu, nic nie ukryte). Filip tę opcję widział i też jej dziś nie wybrał, ale jest bliższa jego intencji niż pełne ukrywanie modułów.

## 2026-08-02 09:45 — Claude — Client automation wishlist captured in docs/roadmap-automatyzacje.md

Filip shared a screenshot of the client's "Włączone automatyzacje" panel — 8 automations they want, 7 enabled. **Nothing from it is implemented and nothing should be started yet**; I wrote it up as a roadmap so we don't re-derive the same analysis later. Full detail in `docs/roadmap-automatyzacje.md`; the parts worth knowing without opening it:

- The client is a **rental/CFM operator**, not an employee fleet (kaucje, oddziały, zwroty, relokacje). This confirms the positioning: Fleetio/fleetster/Chevin all assume the driver is an employee, which is why none of them solve this properly in Poland.
- **Item 6 on their list ("Refaktura mandatów i e-TOLL") is roughly half our current MVP** — `matchVehicleCustomer` already does fine → vehicle → who held it → customer. Missing pieces are the billing side and e-TOLL as a second input alongside scanned letters.
- **Blocking architectural question, unanswered:** does FlotaFlow become the system of record for rentals, or a layer над the client's existing rental system? Almost every item needs a real rental object (mileage limit, fuel at pickup/return, deposit, branch, condition report) — we have `vehicle_assignments` with two dates and an agreement number. My recommendation is the layer-on-top variant, but the deciding question for Filip to ask the client is *"what do you run rental contracts in today, and does it have an API?"*. Do not design any of this before that answer exists.
- **Legal flag on item 7 (risk scoring):** automatically setting a deposit from a customer score is automated individual decision-making under GDPR Art. 22 — needs a legal basis, transparency, and a human-intervention path. Not a "while we're at it" feature. Item 1 (dunning via SMS/phone) has its own telecoms/consent angle.
- Item 4 (dispatch/relocation) needs branches, which the data model has no concept of — `organizations` is the tenant, not a depot.

Suggested order is in the doc; the short version is finish the current MVP for production first, then fuel-cards→TCO (independent, builds the cost ledger), then extend fines into re-invoicing.

## 2026-08-02 10:30 — Claude — Added docs/stan-projektu.md as the onboarding brief

Filip asked for a single file another LLM can read to know what we fixed, what exists and what is still open, so the next agent does not have to reconstruct it from this log. It is `docs/stan-projektu.md`, written in Polish, and `AGENTS.md` now points at it as the first thing to read.

It covers the domain (rental vans + customer trailers crossing 3.5 t → e-TOLL penalty lands on the owner), the architecture, what works, the six things that are broken or unfinished (no invite flow, no tests, unmeasured OCR accuracy, route planner not persisted, missing CRON_SECRET/RESEND keys, schema applied by hand), and a "traps" section covering the assignment-history exclusion constraint, plate normalization, composite FKs, the partial-PATCH semantics and the swallow-the-real-error pattern that made two production failures undiagnosable.

If you change any of those invariants, update that file — it is now the entry point, so a stale statement there is worse than no statement.

## 2026-08-02 — Claude — Simplified roles to admin/boss/user + Zespol UI, updated README/stan-projektu.md

Filip's explicit decision, executed directly (not a proposal — he gave exact accounts and mapping):

- Roles collapsed from 6 to 3: `admin` (full access, incl. team/role management), `boss` (everything `user` can do plus confirming case data), `user` (day-to-day case/fleet/route work, cannot confirm). Old roles (`dispatcher`/`office`/`scanner`/`viewer`) stay in the DB enum only for backward compat — `schema.sql` now runs `update organization_members set role='user' where role in (...)` — never reintroduce them in an RLS policy or `verifyMember()` call.
- `bootstrap_organization` no longer raises on a second signup — every self-registered account joins as `user`. `ALLOW_PUBLIC_SIGNUP` defaulted to `true` in `.env.example` to match. This is a deliberate simplicity-over-invite-flow tradeoff Filip made, not something to "fix" back to blocking without asking him.
- The one sensitive action — confirming a case (`PATCH /api/documents/[id]`) — is now `admin`+`boss` only. Every other endpoint that used to check `admin`+`office` (or `+scanner`/`+dispatcher`) now checks `admin`+`boss`+`user` — functionally everyone does the same work except confirming.
- New `PATCH /api/team` (admin-only): change a member's role. Guards against demoting the last admin. New "Zespol" nav item/screen in `workspace.tsx` (admin-only) with a role `<select>` per member.
- Caught my own mistake before committing: a regex-based bulk edit to `schema.sql` briefly widened `organizations_admin`/`members_admin` RLS policies to `admin,boss,user` — those two **must** stay `admin`-only (org settings, role management itself). Fixed before push; worth double-checking if you touch those policies again.
- Also simplified two data-visibility branches (`documents/route.ts`, `fleet/vehicles/route.ts`) that used to hide OCR text / customer contact details from `scanner`/`viewer` accounts — with only 3 roles now, every member does full case work, so those branches were dead logic gating on roles that no longer get assigned.
- Updated `README.md` (was still describing the original no-backend PoC — completely stale) and `docs/stan-projektu.md` (blocker #1 marked resolved, role model section rewritten).

**Still needed for this to actually take effect on the live DB**: run the updated `supabase/schema.sql` in the Supabase SQL Editor (enum additions + the role migration UPDATE + RLS policy changes). Until that runs, the app code expects roles that don't exist yet in the live enum.

**Not done yet, flagged by Filip as a related but separate ask**: verify OCR extraction quality on the documents already uploaded in the live app (several exist) — needs Filip to paste raw OCR text + current field values per document, since I can't log in myself. Also asked for a code review pass and doc updates elsewhere in the repo — docs done; the code review was this entry's self-check plus the earlier tsc/lint pass, nothing further surfaced.

## 2026-08-02 — Claude — UX pass on Zespol + caught a schema.sql bug that would have silently broken the role migration

- Role change in "Zespol" now requires an explicit Zatwierdz/Anuluj confirm instead of firing on every `<select>` onChange — it's a permission change, treat it like the send-review-package confirm dialog, not a typo-fixable field.
- **Real bug caught during self-review, not yet run on the live DB**: `ALTER TYPE ... ADD VALUE` cannot execute inside a transaction block. I'd wrapped it in `do $$ ... exception when others then null $$`, which doesn't dodge the restriction — a DO block IS a transaction block, and Supabase's SQL Editor also runs a whole pasted script as one transaction. The exception handler was silently swallowing the failure, meaning 'boss'/'user' would never actually land in the enum on Filip's existing database, and every later `CREATE POLICY`/`UPDATE` referencing them would then fail loudly with "invalid input value for enum". Fixed: plain top-level `alter type ... add value if not exists` statements, with an explicit comment that on an existing database these two lines must be run as their OWN separate SQL Editor execution before the rest of the file (a fresh database doesn't need the split — `create type` already includes both values).
- If you ever see `do $$ ... alter type ... add value ... exception ...` anywhere (in this file or elsewhere), that pattern is broken by construction — flag it, don't just add another one for a new value.

## 2026-08-02 — Claude — Mobile UX audit (Safari/Chrome) + favicon

Filip asked to check the newest features (Zespol, send-review-package) on mobile Safari/Chrome and fix anything broken. Couldn't test on a real device/session — no login access — so did a thorough code-level audit against the existing mobile patterns already established in this file (the prior "Mobile UX pass: single-column forms, touch targets, no iOS auto-zoom" commit) instead of guessing blind.

- **Real bug found and fixed**: `.selectBox select`/`.selectBox input` had `font-size: 11px` — well under the 16px iOS Safari needs to avoid zooming the whole page in on focus. That prior "no iOS auto-zoom" pass covered plain text inputs (still 16px, verified) but missed this shared select/filter class entirely. Affects the new Zespol role picker, the doc-list employee filter, and the bug-status selector. Bumped to 16px.
- Verified the new Zespol section and the send-review-package modal both reuse existing, already-mobile-handled classes (`.bugCard`, `.helpModal`, `.primaryButton`/`.secondaryButton` at `min-height: 44px`) rather than introducing new unhandled ones — the one new class I did add (`.teamRoleRow`) has `flex-wrap: wrap` so the select+confirm/cancel buttons don't force horizontal scroll at 375px.
- Added the favicon Filip asked for (white bus on `--blue` #2563eb) — as `public/icon.svg` + explicit `metadata.icons` in `layout.tsx`, not the `src/app/icon.svg` file-convention route. That convention 404'd in local dev for a reason I couldn't pin down (not a `.next` cache issue — the directory didn't exist), so used the path guaranteed to work rather than ship something unverified.
- Also fixed `layout.tsx`'s `<title>`/description, which still said "PoC" with no backend — same staleness README already had before an earlier pass fixed that file. Manifest also got the icon reference for "Add to Home Screen".
- **Verification note**: could not visually confirm any of this in the local dev preview this session — another chat's dev server is already running on the same port/folder and my preview tooling kept observing that stale process (old title, no icon) regardless of restarts. Not a code problem, a local multi-session port conflict. If you're the next agent touching this area, be aware local preview may not reflect your own edits until that other session's server is stopped.

## 2026-08-02 — Claude — Fixed the real cause of "Brak dostepu"/vanishing Flota+Pracownicy, select-arrow click, boss role cap, merged Zespol into Pracownicy

Filip reported four things in one message and asked me to work through them in order. Root-caused and shipped all four (commit `5862383`):

- **`src/lib/supabase-auth.ts` — `verifyMember()`**: removed a manual `Origin` header equality check (added in an earlier Codex hardening pass) that compared the request's `Origin` against `new URL(request.url).origin`. This is what was actually causing "Brak dostepu" on Zespol despite being logged in as admin, Flota/Pracownicy going empty after Filip added `CRON_SECRET` in Vercel (a redeploy, not the cron itself, is what surfaced it), and the "Zatwierdz" role-change button silently failing — all three were the same root cause: Vercel serves the app from multiple valid hostnames (prod domain, per-deployment preview URLs, internal proxy paths) that don't always agree with what `request.url` reconstructs, so legitimate same-origin `fetch()` calls (which send `Origin`) were getting 401'd while plain page navigations (which often don't send `Origin`) still worked. The `ff-access` cookie is already `SameSite=Lax` (see `api/auth/route.ts`), which is the standard, sufficient CSRF defense for cookie auth — the extra check was redundant and actively wrong. **Not yet confirmed fixed by Filip on production** — please don't re-add an Origin check here without understanding this history first.
- **`src/app/workspace.module.css` — `.selectBox`**: the chevron `<svg>` was a flex sibling of the `<select>`, i.e. its own box that intercepted clicks landing on the glyph itself. Made it `position:absolute; pointer-events:none` and gave `.selectBox select` matching `padding-right`, so the whole field is clickable regardless of where in it you tap. Affects every select using this class (Zespol/accounts role picker, doc employee filter, bug status selector).
- **`src/app/api/team/route.ts` — `PATCH`**: boss can now grant at most `boss`/`user`, never `admin`, and is blocked from changing an existing admin's role at all (403 in both cases) — only `admin` manages other admins. Frontend (`src/app/employees.tsx`) mirrors this: the "Admin" `<option>` is hidden from the role `<select>` when the viewer is `boss`, and any row currently holding `admin` renders as a locked read-only badge (no select, no Zatwierdz/Anuluj) for a boss viewer.
- **Merged "Zespol" and "Pracownicy" into one tab** per Filip's ask ("to pasuja do siebie"): the old standalone `activeView === "team"` card-list screen in `workspace.tsx` is gone (nav button, header title branch, and render branch all removed). `src/app/employees.tsx` now takes the team-related props (`team`, `teamPending`, `teamUpdating`, `teamError`, `viewerRole`, `onStagePendingRole`, `onConfirmRole`, `onCancelRole`) from `workspace.tsx` (which still owns the `team` state/`loadTeam()`/`changeTeamRole()` — it's also used for `employeeLabel()` and a doc filter elsewhere) and renders a second section, a real `<table>` (+ `.mobileCards` fallback) reusing `fleet-manager.module.css`'s existing table styles for visual consistency with the driver roster right below it. This accounts/roles table only renders when `viewerRole` is `admin` or `boss`; the driver roster stays visible to everyone as before.
- Note: `.teamRoleRow` in `workspace.module.css` (added in the earlier mobile-UX pass) is now dead CSS — nothing references it after the merge. Left it in place rather than risk touching more than asked; safe to delete whenever someone's next in that file.
- `tsc --noEmit` and eslint both clean (2 pre-existing `react-hooks/exhaustive-deps` warnings on `loadDocuments`, unrelated to this change).

**Still open from the same Filip message, not started yet**: the delivery/route-planner "reordering stops is broken" bug.

## 2026-08-02 — Claude — Registration approval gate: pending accounts can't log in, two Resend emails

Filip's ask: registration stays open (no invite gate), but a new self-registered account can't actually log in until an admin/boss assigns it a role. Shipped (commit `be0a82c`, schema already applied by Filip in the SQL Editor):

- **`supabase/schema.sql`**: `organization_members` gets a `status` column (`pending`/`active`, `check` constraint, default `'active'` so every pre-existing row — including the three real admin/boss accounts — is unaffected by the `ADD COLUMN`). `is_org_member`/`has_org_role` now both additionally require `status='active'` — this is the actual enforcement point, not just an API-layer check, so a pending account has zero RLS access anywhere in the app, not only at login. `bootstrap_organization`: joining an **existing** org lands `role='user', status='pending'`; the very first person ever (brand-new org, nobody to approve them) still lands `admin`/`active` immediately, same as before.
- **Removed `ALLOW_PUBLIC_SIGNUP` entirely** (env var + the 403 gate in `api/auth` POST) — registration is unconditionally open now; `status='pending'` is the real gate. If you see that env var referenced anywhere (Vercel dashboard included), it's dead — safe to delete, code no longer reads it.
- **`src/app/api/auth/route.ts`**: added `membershipByUserId()` which looks up the caller's org-membership row with the **admin key**, bypassing RLS — needed because the ordinary RLS-scoped `membership()` query can't tell "pending" apart from "no membership at all" once `is_org_member` requires `status='active'` (a pending user's own row is invisible to their own token). Sign-up branch: if the resulting membership is `pending`, sends the "thanks for registering, awaiting approval" email and returns `202 { pendingApproval: true, message }` — no session cookie set, so they're not silently logged in. Sign-in branch: if `pending`, returns `403` with a Polish explanation instead of logging in.
- **`src/app/api/team/route.ts` PATCH**: setting a role now also sets `status='active'` in the same request — approving a pending account and assigning it a role is one action, not two, per Filip's ask. Fetches the target's status *before* the update; only sends the "you've been granted access" email on an actual `pending`→`active` transition (re-granting/changing an already-active member's role never re-sends it).
- **`src/lib/account-emails.ts`** (new): the two Resend HTML/text templates, following the existing inline-fetch-to-Resend pattern from `review-package.ts`/`authority-package/route.ts` rather than introducing a shared "send" abstraction — same `RESEND_API_KEY`/`RESEND_FROM_EMAIL` env vars already in use, no new config needed.
- **`src/app/employees.tsx`**: accounts table shows a "Oczekuje na zatwierdzenie" badge, and — this was a real bug I caught before shipping, not just an addition — the Zatwierdź button used to only appear once a role *change* was staged in the `<select>`. A pending account left on the default `role='user'` would never show a confirm button at all, since there's nothing to "change" (pending→pending on the same value). Fixed: Zatwierdź now always shows for a pending row regardless of whether the select was touched, using whatever role is currently selected (staged or default).
- **`src/app/auth-gate.tsx`**: treats `pendingApproval` the same as the existing `confirmationRequired` response shape (shows the message, doesn't flip to "ready").
- Updated `README.md`, `.env.example`, `docs/stan-projektu.md` to match (no more `ALLOW_PUBLIC_SIGNUP` mentions).
- `tsc --noEmit` and eslint both clean (same 2 pre-existing unrelated warnings as before).

**Sequencing note for future schema changes on this table**: this one shipped schema-first — Filip ran the updated `schema.sql` in the SQL Editor, confirmed clean, *then* I pushed the code. Do this in that order for any change where the app code and a new/renamed column must exist together, or every login/signup breaks in the gap between deploy and manual SQL application.

**Not yet verified live**: Filip hasn't yet tried a real end-to-end registration → approval → email flow in production. Worth confirming Resend actually delivers both emails (correct `RESEND_FROM_EMAIL` domain verification, etc.) next time a real signup happens.

## 2026-08-02 — Claude — "Nawiguj" button unresponsive in route planner (commit `568f6f3`)

Filip's report ("jak zmieniłem kolejność w plannerze trasy to tez nie działa") turned out to be about a different button than it first sounded like. Before touching anything I simulated `move()`'s array-swap logic in isolation (outside the app, just the reducer) across multiple sequential moves — it was correct. Asked Filip directly what he actually clicked; he confirmed: **manual reordering itself works fine**, the real symptom is clicking "Nawiguj" (the Google Maps handoff link) does nothing.

Root cause: `src/app/delivery-planner.tsx`'s "Nawiguj" link had `target="_blank"`. `manifest.ts` declares `display: "standalone"` and this app gets added to drivers' home screens as a PWA — WebKit's standalone mode has no "new tab" to open into, so `target="_blank"` silently no-ops on iOS instead of doing anything. Removed `target="_blank"` (kept `rel="noreferrer"`); navigating in the same context is actually the right behavior here anyway, since mobile OSes intercept a `google.com/maps/dir` universal link and hand off to the native Maps app regardless of tab context.

**Not yet confirmed fixed on a real phone** — worth Filip testing "Nawiguj" from the installed home-screen PWA on an actual delivery run. If `target="_blank"` needs to come back for some other reason later, don't — this exact combination (standalone PWA + target=_blank) is the trap.

This closes out the full batch of bugs from Filip's last big message (Origin/Brak dostępu, select-arrow click, boss role cap, Zespol/Pracownicy merge, registration approval gate, route-planner button) — nothing outstanding from that batch.

## 2026-08-02 — Claude — Static bug-report button, self-service name edit (commit `003638a`)

Two small requests from a screenshot of the sidebar footer:

- **"Zgłoś błąd" moved out of the account dropdown**, now a static/always-visible button in `workspace.tsx`'s `.sidebarFooter`, between the "Dane chronione" note and the account card — visible to every role (not gated), matching what Filip described as a feature that used to exist and got lost. The account dropdown still has "Ustawienia" and "Wyloguj się". Reused `.navItem` styling; added `.sidebarFooter button.navItem { width:100%; text-align:left; cursor:pointer }` in `workspace.module.css` since the existing `.nav button.navItem` rule that supplies those only applies inside `<nav>`.
- **Confirmed (no change needed): the "Błędy" nav tab (the admin panel listing all reports) is already `account?.role === "admin"` only** — Filip asked to double check this after the Zespol/Pracownicy merge; it was untouched by that merge and still correct.
- **Real bug fixed**: `workspace.tsx` had a hardcoded `displayNameOverrides` map (`{"fkedziorawenet@gmail.com": "Filip Kędziora", "fkedziora@wenet.pl": "user Kędziora"}`) — a leftover placeholder/typo literally showing "user Kędziora" instead of "Filip Kędziora" for his real admin account. Removed the whole map; `accountDisplayName()` now just falls back to `firstName + lastName` from Supabase `user_metadata`, same logic for every account regardless of role — no more per-email patches.
- Since some existing accounts (bootstrapped directly, not through the signup form) never got `first_name`/`last_name` set, removing the override alone wasn't enough — **added self-service name editing**: `PATCH /api/auth` now accepts optional `firstName`/`lastName` alongside the existing `newPassword` (either independently), sent as `data: {first_name, last_name}` in the `PUT /auth/v1/user` call using the user's own access token. Supabase merges `data` into existing `user_metadata` rather than replacing it, so `phone`/`privacy_consent_at` set at signup survive a name-only edit — confirmed this is documented Supabase behavior, didn't fetch-then-merge manually. Settings modal's "Imię i nazwisko" field is now editable inputs + a save button instead of read-only text, prefilled from `account` when the modal opens.

**Still needs Filip**: open Ustawienia and set his own first/last name once (same for any other account missing it, e.g. michalgromjr@gmail.com) — the code fix makes this self-correctable but doesn't retroactively fix data for accounts that never went through the signup form.

## 2026-08-02 — Claude — Parked RESEND_API_KEY/SMTP, corrected the "edit Supabase template for free" claim

Filip decided to park Resend/SMTP setup entirely — he doesn't have a domain mailbox. `docs/stan-projektu.md` section 5 rewritten accordingly; **do not re-propose Resend setup or "quick workarounds" without asking him first**, the alternatives below were explicitly checked and rejected in this conversation.

I initially told him editing Supabase Auth's "Confirm signup" template content (to add pending-approval wording, in Polish) was free and required no domain, since Supabase's own confirmation email already works without Resend. **That was wrong.** He sent a screenshot of the Vercel/Supabase email-template panel: the Subject/Body fields are grayed out with "Emails will be sent using the default templates. Set up custom SMTP to edit their subject and body." Editing template *content* on the shared mailer requires the same custom SMTP we were trying to avoid — only the *sending* of the default (English, generic) template is free. Corrected this with him directly; don't repeat the "template edit is free" claim.

Also fixed one small consequence of parking this: `src/app/api/auth/route.ts`'s `pendingApproval` response message used to promise "otrzymasz e-mail, gdy uzyskasz dostęp" — that promise depends on `RESEND_API_KEY` (the role-granted email), which is now deliberately unconfigured. Softened the message to not promise an email channel. Note this branch only fires if Supabase's own "Confirm email" requirement is ever turned off (currently on, per Filip: "linki aktywacyjne... działały i dochodziły" — confirms email confirmation is required today, so the `confirmationRequired: true` branch fires first and this specific message is presently unreachable in practice, but the fix costs nothing and prevents a live inconsistency if that setting ever changes).

If this comes back up: the only two real options are (a) keep Supabase's default English confirm-email template, zero cost, or (b) set up SMTP/Resend properly, which unlocks all three emails at once (registration-received, role-granted, review-package-with-attachment) rather than doing it piecemeal. Cheapest real path to (b) is a ~30-60 zł/rok domain that bundles a mailbox (home.pl, OVH-style registrars).

## 2026-08-02 — Claude — Driver location tracking: analysis only, docs/namierzanie-kierowcy.md

Filip asked how to handle mid-day route changes given the driver's Maps navigation always starts from their live GPS position — nothing implemented, this was explicitly a "write it up, don't build it" request.

Key points if you pick this up: (1) route_stops.status already gives the dispatcher a coarse "where in the sequence" signal for free — don't rebuild that. (2) Maps omitting `origin` and using live GPS is correct behavior, not a bug — the actual gap is dispatcher-side visibility, not navigation. (3) True background GPS tracking is not achievable as a PWA (iOS Safari has no background geolocation for web content when the tab/PWA isn't foregrounded) — don't design around it without first deciding to build a native app. Recommended: Phase 1 = explicit one-shot "Zgłoś lokalizację" button + last-known-position display for the dispatcher, cheap and consent-clean. Phase 2 (foreground-only periodic ping, explicit toggle, visible indicator) only if Phase 1 proves insufficient in practice.

## 2026-08-03 — Claude — Imię/nazwisko z rejestracji (sprawdzone, działa) + analiza: blokada zajętego pojazdu / przypomnienie dla kierowcy / edycja trasy w trakcie dnia (zdiagnozowane, nic jeszcze nie zaimplementowane)

**Część 1 — zamknięta, bez zmian w kodzie.** Filip: "imię i nazwisko usera
powinno być zaciągane z bazy z tego co wpisał przy rejestracji". Sprawdziłem
cały łańcuch: `POST /api/auth` (signup) zapisuje `first_name`/`last_name` do
`user_metadata` w Supabase Auth już przy rejestracji; `GET /api/team`
(`src/app/api/team/route.ts:60-77`) czyta dokładnie z `user_metadata` przez
Admin API; `employeeLabel()` w `workspace.tsx:461-465` poprawnie z tego
korzysta wszędzie (Dokumenty, Sprawy, planer tras), z fallbackiem na e-mail
tylko gdy `user_metadata` jest puste. Mechanizm już działa tak, jak Filip
chce — surowe maile, które widział w filtrach, to konta bez wypełnionych
metadanych (założone przed wdrożeniem zbierania imienia/nazwiska przy
rejestracji, albo user nigdy nie wszedł w Ustawienia). Jedyny realny fast-follow,
gdyby wrócił do tego: dać adminowi możliwość wpisania imienia/nazwiska za
innego usera w panelu Pracownicy (dziś `PATCH /api/team` zmienia tylko rolę,
nie imię) — nieproszony, nie zaczynaj bez pytania.

**Część 2 — zdiagnozowana, zero kodu napisanego, przerwana brakiem limitu.**
Filip: pojazd nie powinien dać się wybrać do nowej dostawy, dopóki ma
nierozwiązaną poprzednią (potwierdził, że to pożądane zachowanie), ale nie
może utknąć na zawsze bez powiadomienia kierowcy, a modyfikacja trasy po
starcie dnia potrzebuje "sensownej logiki" zamiast pełnej blokady. Utworzyłem
3 taski (Task tool, id #15/#16/#17 w tej sesji — nie przetrwają między
sesjami, tylko dla porządku w tej rozmowie).

Zanim zacząłem pisać kod, przeczytałem cały istniejący flow i **sporo już
istnieje** — nie buduj tego od zera:

- `PATCH /api/routes/plan/stops/[id]` (`src/app/api/routes/plan/stops/[id]/route.ts`)
  już zapisuje `delivered`/`failed` na pojedynczym stopie i przy `delivered`
  ustawia `delivery_orders.delivered_at`.
- `POST /api/routes/plan/reorder` (`src/app/api/routes/plan/reorder/route.ts`)
  już woła RPC `reorder_route_stops` z pełną tablicą id — generyczny
  mechanizm, nie trzeba go zmieniać.
- `delivery-planner.tsx` ma już gotowy UI potwierdzenia dostawy: `currentStop`
  (pierwszy stop ze `status==='planned'`), sekcja "NAJBLIŻSZA DOSTAWA" z
  przyciskami Auto wydane / Nie dostarczono / Przełóż na koniec, oraz modal
  potwierdzenia (`pendingAction`, `confirmStopAction()`, linie ~956-1145).

Czego brakuje — konkretny plan do zaimplementowania:

1. **Blokada zajętego pojazdu** (dziś nic tego nie pilnuje). `GET
   /api/fleet/vehicles` (`src/app/api/fleet/vehicles/route.ts`) ma dodać
   `busy: boolean` — jeden dodatkowy fetch: `delivery_orders?select=vehicle_id
   &organization_id=eq...&delivered_at=is.null`, zbudować `Set` zajętych id.
   `POST /api/routes/deliveries` (`src/app/api/routes/deliveries/route.ts`)
   ma po walidacji pojazdu sprawdzić, czy już ma otwartą dostawę i zwrócić 409
   z czytelnym komunikatem. `delivery-planner.tsx`: `FleetVehicle` +`busy`,
   disabled `<option>` z etykietą "(w trasie)" w pickerze (linie ~730-754).

2. **Realny bug, znaleziony przy czytaniu kodu — to jest właściwa przyczyna
   "auto może utknąć na zawsze" bardziej niż brak powiadomienia**: `GET`,
   `POST` i `DELETE` w `src/app/api/routes/plan/route.ts` filtrują "aktywny
   plan" po `planned_for=eq.<dzisiaj>`. Jeśli plan z wczoraj nie został
   dokończony (nadal `status='active'`, ma stopy `'planned'`), **staje się
   niewidoczny i niezarządzalny**: `GET` go nie zwróci (szuka tylko
   dzisiejszego), "Zmień dostawy" (`DELETE`) go nie superseduje (to samo
   filtrowanie), a jego pojazdy zostają zajęte bez żadnej ścieżki w UI do
   odblokowania poza ręcznym SQL. Napraw usuwając filtr `planned_for` z tych
   trzech miejsc — inwariant ma być "jeden aktywny plan na organizację", nie
   "na dzień"; `planned_for` zostaje jako metadana zapisywana przy tworzeniu,
   nie jako klucz zapytania. To samo naprawia "trasa przenosi się na kolejny
   dzień, jeśli nieskończona" w sposób naturalny.

3. **Przypomnienie dla kierowcy**: lekki endpoint zliczający `route_stops`
   ze `status='planned'` (dowolny aktywny plan, po naprawie punktu 2 to już
   tylko jeden na organizację) + badge w nawigacji `workspace.tsx` przy
   "Planer tras" (wzorem badge'a "Błędy", `.navCount`, linie ~1379-1388) i/lub
   w `NotificationsBell` (`workspace.tsx:2882`, dziś obsługuje tylko zgłoszenia
   błędów — da się rozszerzyć o drugi typ powiadomienia). Po naprawie punktu 2
   sam UI plannera (`currentStop` + modal) znów będzie widoczny przy każdym
   wejściu niezależnie od tego, kiedy plan powstał — badge jest dodatkowym
   nudge poza ekranem plannera, nie jedynym mechanizmem.

4. **Reorder mid-route**: `move()` w `delivery-planner.tsx` (linia ~381) i
   strzałki góra/dół w JSX (linia ~1030: `{!routeStarted && (...)}`) chowają
   się całkowicie, gdy którykolwiek stop jest już rozwiązany. Trzeba pokazywać
   strzałki dla stopów `status==='planned'` nawet gdy `routeStarted`, ale
   reorder ma działać **tylko wśród `'planned'` stopów** — rozwiązane
   (`delivered`/`failed`) zostają na swoich bezwzględnych pozycjach w tablicy
   wysyłanej do `persistOrder()`/RPC. RPC się nie zmienia, zmienia się tylko
   to, którą podtablicę UI mu wysyła.

5. **Doklejenie nowej dostawy do aktywnego planu bez resetu całej trasy**:
   dziś przy `plan` truthy ekran wyboru dostaw (`addStopButton`,
   `addStopForm`) w ogóle się nie renderuje — jedyna opcja to "Zmień
   dostawy" (`changeDeliveries()` → `DELETE /api/routes/plan`), które
   supersedeuje cały plan. Potrzebny nowy `POST /api/routes/plan/stops`,
   który: tworzy `delivery_orders` (reużyj logikę z `POST
   /api/routes/deliveries`) i doklein `route_stops` na koniec **aktywnego**
   planu (`position = max(position)+1`), bez supersedowania. UI: pokazać
   przycisk "Dodaj dostawę" także na ekranie aktywnego planu, formularz
   identyczny jak dziś, tylko inny endpoint docelowy gdy `plan` już istnieje.

**Kolejność, w jakiej bym to robił**: najpierw punkt 2 (bug, mały zasięg,
odblokowuje resztę), potem 1 (blokada, niezależna), potem 3 (badge, zależny
od 2), na końcu 4 i 5 (UI, największy zasięg zmian w `delivery-planner.tsx`).
Zero kodu z tego zostało napisane w tej sesji — tylko analiza i ten plan.

## 2026-08-03 — Claude — Automated schema migrations (Supabase CLI), replaces manual schema.sql

Filip's ask, after the "run schema.sql yourself before I push" dance we did earlier this session for the registration-approval-gate feature: stop this from being a recurring manual step that's easy to get out of order with a code deploy (this exact drift already caused a production outage once — see `docs/stan-projektu.md` §6 history). Merged with Codex's concurrent work on the same file — see the schema-drift-canary entry in the `api/health` history and the branches/notifications/reorder additions folded into the migration below; nothing here reverts any of that.

- **`supabase/schema.sql` is gone.** Its full content — including Codex's `branches`/`vehicle_relocations`/`reorder_route_stops`/`notifications_seen_at`/`delivery_orders.delivered_at`/`bug_report_status` additions, all still idempotent — is now `supabase/migrations/20260802000000_baseline_schema.sql`, the first Supabase-CLI-tracked migration. Git's merge folded Codex's schema.sql edits into this renamed file automatically (rename+edit resolved cleanly); I only reviewed the result, didn't hand-merge it.
- **`scripts/migrate-db.mjs`**, wired into `package.json`'s `build` script (`node scripts/migrate-db.mjs && next build`) and also exposed standalone as `npm run db:migrate`. It runs `supabase db push --db-url "$SUPABASE_DB_URL" --include-all --yes`.
- **Deliberately fail-soft when the secret is missing, fail-hard when the command actually fails.** If `SUPABASE_DB_URL` isn't set, it logs a warning and exits 0 — the build proceeds without migrating, same as today's status quo, so shipping this doesn't itself break any deploy. If the var IS set and `db push` returns a non-zero exit code, the script exits non-zero too, which fails the whole `npm run build` — a real migration failure must never let the app deploy against a schema that didn't actually update, which is the original bug pattern this is fixing. Verified both paths locally: `npm run db:migrate` without the var prints the warning and exits 0; `npm run build` end-to-end (full `next build`) completes successfully in that same no-var state.
- Added `supabase` as a pinned devDependency (`2.111.0`, not `^`/`latest` — a CLI version bump changing `db push` behavior mid-flight is not something to discover on a production build) so `npx supabase` in the script resolves to the local install instead of downloading fresh every build.
- `supabase init` also generated `supabase/config.toml` and `supabase/.gitignore` — standard CLI project scaffolding (local Docker dev ports, `.branches`/`.temp` ignores), no secrets in either, committed as-is.
- Updated every reference to the old manual-paste workflow: `README.md`, `docs/stan-projektu.md` (§6 marked resolved, file map table, role-migration mention), `.env.example` (new `SUPABASE_DB_URL` var, explicitly distinguished from the REST/Auth keys), and three code comments/error strings in `api/auth/route.ts`, `supabase-auth.ts`, `api/documents/[id]/route.ts` that used to point at `schema.sql`.
- Complements, doesn't replace, Codex's schema-drift canary on `/api/health` (checks specific columns exist) — that's reactive detection for if something ever slips through; this is the preventive fix so it shouldn't need to fire going forward. Leave both in place.
- New schema change from now on: `npx supabase migration new <name>` creates a new timestamped file in `supabase/migrations/`; commit it with the code that needs it, push, done — no more separate "go run this in the SQL Editor first" step, no more sequencing dance.

**Still needs Filip**: add `SUPABASE_DB_URL` in Vercel (Project Settings → Environment Variables) — the Postgres connection string with the DB password, from Supabase Dashboard → Project Settings → Database → Connection string → URI. Until that's set, migrations keep not applying automatically (same as before, just with a visible warning in build logs instead of silence) — this change is safe to ship either way, but it isn't actually solving the problem until that variable exists.

## 2026-08-03 — Claude — Merged Michał Grom's PR #1 (password reset, QA-review fixes, safe vehicle delete)

New contributor on this repo, not just Claude/Codex — Michał opened GitHub PR #1 from a fork (`Mgrom:main` → `FilipSeoCC:main`), three commits, two of them co-authored with his own Claude Code session. Filip pointed me at it via a screenshot after asking "zobacz co się zmieniło"; I fetched it with `git fetch origin refs/pull/1/head`, reviewed each commit, then verified in an isolated `git worktree` (not the main working copy) before merging anything — `npm install`, `tsc --noEmit`, `eslint .`, and a full `npm run build`, all clean, before touching `main`.

- **`src/app/api/auth/reset/route.ts` + `src/app/reset-hasla/page.tsx`** (new): password reset via Supabase's own `/auth/v1/recover` — POST always returns the same generic message regardless of whether the email is registered (no account enumeration), PUT sets the new password using the recovery access token from the emailed link. **This works independently of the parked `RESEND_API_KEY`** — Supabase Auth's built-in transactional emails (recovery, confirm-signup) go through Supabase's own shared mailer, not through the app's Resend integration. Don't lump this in if `RESEND_API_KEY` ever comes up again.
- Split the combined "podaj poprawny e-mail i hasło..." validation message in `api/auth/route.ts` into two field-specific checks, and fixed `auth-gate.tsx`'s password `minLength` (was hardcoded `8` even during sign-up, which actually requires `12` server-side — the browser let short passwords through before the server rejected them).
- **Real data-integrity bug fixed**: vehicle `DELETE` (`api/fleet/vehicles/[id]/route.ts`) used to hard-delete — order was delete `vehicle_assignments` first, then the vehicle — so if the vehicle delete itself failed partway (e.g. the `delivery_orders` FK restrict), assignment history was already gone with nothing to show for it. Now soft-deletes (`status='removed'`, closes open assignments) instead; `GET` filters removed vehicles out, re-adding the same plate revives the row.
- A batch of "QA review" fixes (his own review pass, not mine): real vehicle-assignment status/date instead of hardcoded "Aktywny"/"Dzisiaj", real OCR confidence % instead of a hardcoded "92%", `caseNumber` field losing edits on save, multi-page document signing/preview with working prev/next, the route planner header showing the actual logged-in user instead of a hardcoded "Wadim", delete confirmations on vehicle/employee/stop matching the existing case-delete pattern, a sign-up password-confirm field, de-hardcoded "Supabase nie jest skonfigurowany" strings into a user-facing message across every API route, Polish pluralization fixes.
- Clean merge, no conflicts — PR's base was exactly my current `main` tip, nothing else had landed in between.

**Not yet verified live** — worth Filip trying the password-reset flow end to end once (the Supabase recovery email actually needs "Confirm email"-equivalent settings to be sane in the Supabase Auth dashboard; haven't checked those specifically for the recovery template).
