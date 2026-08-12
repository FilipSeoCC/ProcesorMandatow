# Graph Report - ProcesorMandatow-onboarding  (2026-08-12)

## Corpus Check
- 108 files · ~84,804 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 799 nodes · 1453 edges · 68 communities (52 shown, 16 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `46c714a9`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- mandate-ocr.ts
- authority-response.ts
- workspace.tsx
- delivery-planner.tsx
- devDependencies
- compilerOptions
- review-package/route.ts
- verifyMember
- 20260802000000_baseline_schema.sql
- dependencies
- supabase-auth.ts
- adminHeaders
- history/route.ts
- Agent handoff log
- vehicles/route.ts
- health/route.ts
- check-authority-detection.cjs
- auth/route.ts
- map-client-fleet-import.mjs
- Stan projektu FlotaFlow — brief dla kolejnego agenta
- drivers/route.ts
- deliveries/route.ts
- getSupabaseServerEnv
- branches/route.ts
- supabase-env.ts
- layout.tsx
- team/route.ts
- What You Must Do When Invoked
- polityka-prywatnosci/page.tsx
- proxy.ts
- eslint.config.mjs
- next.config.ts
- postcss.config.mjs
- migrate-db.mjs
- vercel.json
- public.route_plans
- Priorytet 2 — potrzebne do uruchomienia obecnego zakresu (mandaty + e-TOLL)
- relocate/route.ts
- Namierzanie lokalizacji kierowcy — analiza, nic nie wdrożone
- Wysyłka pisma do klienta - kontrakt wdrożenia
- graphify reference: extra exports and benchmark
- Roadmapa automatyzacji — lista życzeń klienta
- 20260811000000_auth_security.sql
- Bug reporting — design
- scripts
- graphify reference: query, path, explain
- drivers/[id]/route.ts
- Produkcyjne minimum bezpieczeństwa
- Q: Audit current auth flow: localStorage session token, server-side admin authorization, MFA/OTP, login and password-reset rate limits, and password policy/leaked-password checks.
- graphify reference: add a URL and watch a folder
- graphify reference: commit hook and native CLAUDE.md integration
- graphify reference: incremental update and cluster-only
- package.json
- CLAUDE.md
- graphify reference: GitHub clone and cross-repo merge
- graphify reference: transcribe video and audio
- Test MVP: mandat od zdjęcia do klienta
- extraction-spec.md
- reorder/route.ts
- lucide-react
- @types/pdfkit
- Q: Zabezpieczenie rejestracji i logowania FlotaFlow
- typescript
- stops/[id]/route.ts
- 20260812000000_remove_mfa_requirement.sql

## God Nodes (most connected - your core abstractions)
1. `getSupabaseServerEnv()` - 96 edges
2. `adminHeaders()` - 83 edges
3. `verifyMember()` - 78 edges
4. `Agent handoff log` - 32 edges
5. `writeAuditEvent()` - 26 edges
6. `buildAuthorityResponsePdf()` - 22 edges
7. `buildClientNoticePdf()` - 21 edges
8. `cleanLine()` - 16 edges
9. `compilerOptions` - 16 edges
10. `processMandateOcr()` - 15 edges

## Surprising Connections (you probably didn't know these)
- `POST()` --calls--> `verifyMember()`  [EXTRACTED]
  src/app/api/routes/geocode/route.ts → src/lib/supabase-auth.ts
- `GET()` --calls--> `verifyMember()`  [EXTRACTED]
  src/app/api/auth/onboarding/route.ts → src/lib/supabase-auth.ts
- `GET()` --calls--> `getSupabaseServerEnv()`  [EXTRACTED]
  src/app/api/auth/onboarding/route.ts → src/lib/supabase-env.ts
- `PATCH()` --calls--> `verifyMember()`  [EXTRACTED]
  src/app/api/auth/onboarding/route.ts → src/lib/supabase-auth.ts
- `PATCH()` --calls--> `getSupabaseServerEnv()`  [EXTRACTED]
  src/app/api/auth/onboarding/route.ts → src/lib/supabase-env.ts

## Import Cycles
- None detected.

## Communities (68 total, 16 thin omitted)

### Community 0 - "mandate-ocr.ts"
Cohesion: 0.07
Nodes (45): maxDuration, PageRow, POST(), runtime, GET(), maxDuration, runtime, coordinate() (+37 more)

### Community 1 - "authority-response.ts"
Cohesion: 0.19
Nodes (35): AuthorityContext, AuthorityRecipient, authorityReference(), buildAuthorityResponsePdf(), buildAuthorityResponseText(), buildAuthorityReviewPackage(), display(), escapeHtml() (+27 more)

### Community 2 - "workspace.tsx"
Cohesion: 0.05
Nodes (46): authHeaders(), Branch, Branches(), BranchVehicle, emptyForm, Employee, Employees(), emptyForm (+38 more)

### Community 3 - "delivery-planner.tsx"
Cohesion: 0.07
Nodes (30): AuthGate(), readOnboardingData(), authHeaders(), Delivery, DeliveryPlanner(), depot, FleetVehicle, formatWindow() (+22 more)

### Community 4 - "devDependencies"
Cohesion: 0.12
Nodes (17): eslint, eslint-config-next, devDependencies, eslint, eslint-config-next, supabase, tailwindcss, @tailwindcss/postcss (+9 more)

### Community 5 - "compilerOptions"
Cohesion: 0.07
Nodes (28): dom, dom.iterable, esnext, **/*.mts, .next/dev/types/**/*.ts, next-env.d.ts, .next/types/**/*.ts, node_modules (+20 more)

### Community 6 - "review-package/route.ts"
Cohesion: 0.24
Nodes (10): DocumentRow, PageRow, POST(), runtime, runtime, buildClientMessage(), buildReviewPackage(), display() (+2 more)

### Community 7 - "verifyMember"
Cohesion: 0.13
Nodes (16): allowedAttachmentTypes, allRoles, GET(), POST(), runtime, POST(), runtime, DELETE() (+8 more)

### Community 8 - "20260802000000_baseline_schema.sql"
Cohesion: 0.24
Nodes (18): auth, auth.users, public, public.audit_events, public.bootstrap_organization(), public.customers, public.delivery_orders, public.has_org_role() (+10 more)

### Community 9 - "dependencies"
Cohesion: 0.12
Nodes (17): @fontsource/noto-sans, google-auth-library, next, dependencies, @fontsource/noto-sans, google-auth-library, next, pdfkit (+9 more)

### Community 10 - "supabase-auth.ts"
Cohesion: 0.07
Nodes (45): GET(), loadMetadata(), PATCH(), roles, runtime, stepValue(), textValue(), UserMetadata (+37 more)

### Community 11 - "adminHeaders"
Cohesion: 0.20
Nodes (16): GET(), runtime, DELETE(), GET(), POST(), resolveAssignedUserId(), roles, runtime (+8 more)

### Community 12 - "history/route.ts"
Cohesion: 0.33
Nodes (5): GET(), PlanRow, roles, runtime, StopRow

### Community 13 - "Agent handoff log"
Cohesion: 0.06
Nodes (32): 2026-08-01 21:15 — Claude — Bug review + fixes on `main`, plus a coordination gap to flag, 2026-08-01 21:30 — Claude — DECYZJA FILIPA: mobilny "Skaner dokumentów" ODRZUCONY, nie buduj tego, 2026-08-01 — Claude — Built the auto-rematch sweep, added vercel.json crons, name plausibility check, 2026-08-01 — Claude — Email content spec from Filip, for Codex's send-review-package backend, 2026-08-01 — Claude — Fixed wrong plate extraction (car model matched instead of "nr rej."), 2026-08-01 — Claude — Frontend for "send review package to employee" (Filip: Claude=frontend, Codex=backend), 2026-08-01 — Claude — GCP setup, WIF auth fix, event time extraction, merged Codex's branch, 2026-08-01 — Claude — Plausibility checks for match inputs + tabular time-extraction fix (+24 more)

### Community 14 - "vehicles/route.ts"
Cohesion: 0.13
Nodes (18): POST(), runtime, AssignmentRow, CustomerRow, GET(), isOverlapViolation(), POST(), readRoles (+10 more)

### Community 15 - "health/route.ts"
Cohesion: 0.50
Nodes (4): columnsPresent(), GET(), runtime, SCHEMA_CHECKS

### Community 16 - "check-authority-detection.cjs"
Cohesion: 0.17
Nodes (11): assert, bodySentence, canard, fs, gitd, loaded, municipalGuard, path (+3 more)

### Community 17 - "auth/route.ts"
Cohesion: 0.14
Nodes (25): allRoles, authError(), AuthSession, bootstrap(), DELETE(), GET(), Membership, membershipByUserId() (+17 more)

### Community 18 - "map-client-fleet-import.mjs"
Cohesion: 0.22
Nodes (16): assignments, customers, result, vehicles, aliases, argumentsFrom(), buildImportRows(), csvCell() (+8 more)

### Community 19 - "Stan projektu FlotaFlow — brief dla kolejnego agenta"
Cohesion: 0.07
Nodes (24): graphify, Procesor Mandatów / FlotaFlow, Working with another agent on this repo, 1. ~~Nie da się dodać drugiego użytkownika~~ — rozwiązane 2026-08-02, 2. Zero testów, 3. Nieznana skuteczność OCR, 4. ~~Planer tras nie zapisuje nic do bazy~~ — rozwiązane, ale ma otwarte luki (patrz niżej), 5. `RESEND_API_KEY` — świadomie zaparkowane (**nie zaczynaj od nowa bez pytania Filipa**) (+16 more)

### Community 20 - "drivers/route.ts"
Cohesion: 0.27
Nodes (9): DriverRow, GET(), POST(), readRoles, runtime, text(), toDriver(), validStatuses (+1 more)

### Community 21 - "deliveries/route.ts"
Cohesion: 0.24
Nodes (9): CustomerRow, DeliveryRow, GET(), isoTimestampOrNull(), POST(), roles, runtime, text() (+1 more)

### Community 22 - "getSupabaseServerEnv"
Cohesion: 0.29
Nodes (12): POST(), PUT(), PATCH(), validStatuses, clearAuthRateLimits(), consumeAuthRateLimits(), LimitRule, rateLimitedResponse() (+4 more)

### Community 23 - "branches/route.ts"
Cohesion: 0.29
Nodes (7): BranchRow, GET(), POST(), roles, runtime, text(), VehicleRow

### Community 24 - "supabase-env.ts"
Cohesion: 0.22
Nodes (6): DocumentRow, GET(), DELETE(), runtime, writeRoles, first()

### Community 25 - "layout.tsx"
Cohesion: 0.40
Nodes (3): inter, metadata, viewport

### Community 26 - "team/route.ts"
Cohesion: 0.27
Nodes (9): ASSIGNABLE_ROLES, GET(), PATCH(), runtime, sendRoleGrantedEmail(), buildRegistrationReceivedEmail(), buildRoleGrantedEmail(), escapeHtml() (+1 more)

### Community 27 - "What You Must Do When Invoked"
Cohesion: 0.08
Nodes (24): For /graphify add and --watch, For /graphify query, For the commit hook and native CLAUDE.md integration, For --update and --cluster-only, /graphify, Honesty Rules, Interpreter guard for subcommands, Part A - Structural extraction for code files (+16 more)

### Community 39 - "Priorytet 2 — potrzebne do uruchomienia obecnego zakresu (mandaty + e-TOLL)"
Cohesion: 0.12
Nodes (16): Autostrady koncesyjne i strefy parkowania, Dane do pism wychodzących, Domena pocztowa — świadomie zaparkowane, e-TOLL — dostęp integracyjny, Karty paliwowe — jeśli interesuje ich pozycja „TCO" z roadmapy, Podstawa prawna dla scoringu ryzyka / automatycznej kaucji, Prawdziwe skany mandatów do testu skuteczności OCR, Priorytet 1 — blokuje architekturę, pytać jako pierwsze (+8 more)

### Community 40 - "relocate/route.ts"
Cohesion: 0.67
Nodes (3): POST(), runtime, text()

### Community 41 - "Namierzanie lokalizacji kierowcy — analiza, nic nie wdrożone"
Cohesion: 0.18
Nodes (10): Co już mamy — zanim zaczniemy dokładać nowe rzeczy, Dane osobowe — zanim to wdrożymy, Dlaczego samo Maps już robi właściwą rzecz, Faza 1 (rekomendowana na start): jednorazowe „Zgłoś lokalizację", Faza 2 (opcjonalnie, jeśli Faza 1 okaże się niewystarczająca): ping w tle aplikacji (nie w tle systemu), Namierzanie lokalizacji kierowcy — analiza, nic nie wdrożone, Odrzucone: ciągłe śledzenie w tle systemowym, Rekomendacja (+2 more)

### Community 42 - "Wysyłka pisma do klienta - kontrakt wdrożenia"
Cohesion: 0.20
Nodes (9): Dane pobierane automatycznie, Dodatkowe dane sprawy, Drugi typ korespondencji: odpowiedź do urzędu, Formularz admina: Dane biura, Formularz biura: Przed wysłaniem, Szablon odpowiedzi do urzędu, Treść, Wysyłka pisma do klienta - kontrakt wdrożenia (+1 more)

### Community 43 - "graphify reference: extra exports and benchmark"
Cohesion: 0.22
Nodes (8): graphify reference: extra exports and benchmark, Step 6b - Wiki (only if --wiki flag), Step 7 - Neo4j export (only if --neo4j or --neo4j-push flag), Step 7a - FalkorDB export (only if --falkordb or --falkordb-push flag), Step 7b - SVG export (only if --svg flag), Step 7c - GraphML export (only if --graphml flag), Step 7d - MCP server (only if --mcp flag), Step 8 - Token reduction benchmark (only if total_words > 5000)

### Community 44 - "Roadmapa automatyzacji — lista życzeń klienta"
Cohesion: 0.22
Nodes (8): Co już mamy, Czego świadomie tu nie ma, Główna decyzja do podjęcia, zanim cokolwiek zaczniemy, Lista z panelu klienta, Proponowana kolejność, Roadmapa automatyzacji — lista życzeń klienta, Uwagi per pozycja, Zależności

### Community 45 - "20260811000000_auth_security.sql"
Cohesion: 0.38
Nodes (5): auth.mfa_factors, public.auth_rate_limits, public.has_org_role(), public.is_org_member(), public.organization_members

### Community 46 - "Bug reporting — design"
Cohesion: 0.29
Nodes (6): API, Bug reporting — design, Data model, Out of scope for this pass, Problem, UI

### Community 47 - "scripts"
Cohesion: 0.25
Nodes (8): scripts, build, db:migrate, dev, lint, start, test:authority, test:fleet-import

### Community 48 - "graphify reference: query, path, explain"
Cohesion: 0.33
Nodes (5): For /graphify explain, For /graphify path, graphify reference: query, path, explain, Step 0 — Constrained query expansion (REQUIRED before traversal), Step 1 — Traversal

### Community 49 - "drivers/[id]/route.ts"
Cohesion: 0.50
Nodes (3): DELETE(), runtime, writeRoles

### Community 50 - "Produkcyjne minimum bezpieczeństwa"
Cohesion: 0.40
Nodes (4): OCR, Operacje, Produkcyjne minimum bezpieczeństwa, Przed wpuszczeniem pracowników

### Community 51 - "Q: Audit current auth flow: localStorage session token, server-side admin authorization, MFA/OTP, login and password-reset rate limits, and password policy/leaked-password checks."
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Audit current auth flow: localStorage session token, server-side admin authorization, MFA/OTP, login and password-reset rate limits, and password policy/leaked-password checks., Source Nodes

### Community 52 - "graphify reference: add a URL and watch a folder"
Cohesion: 0.50
Nodes (3): For /graphify add, For --watch, graphify reference: add a URL and watch a folder

### Community 53 - "graphify reference: commit hook and native CLAUDE.md integration"
Cohesion: 0.50
Nodes (3): For git commit hook, For native CLAUDE.md integration, graphify reference: commit hook and native CLAUDE.md integration

### Community 54 - "graphify reference: incremental update and cluster-only"
Cohesion: 0.50
Nodes (3): For --cluster-only, For --update (incremental re-extraction), graphify reference: incremental update and cluster-only

### Community 55 - "package.json"
Cohesion: 0.50
Nodes (3): name, private, version

### Community 61 - "reorder/route.ts"
Cohesion: 0.67
Nodes (3): POST(), runtime, text()

### Community 64 - "Q: Zabezpieczenie rejestracji i logowania FlotaFlow"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Zabezpieczenie rejestracji i logowania FlotaFlow, Source Nodes

### Community 66 - "stops/[id]/route.ts"
Cohesion: 0.67
Nodes (3): PATCH(), runtime, text()

### Community 67 - "20260812000000_remove_mfa_requirement.sql"
Cohesion: 0.67
Nodes (3): public.has_org_role(), public.is_org_member(), public.organization_members

## Knowledge Gaps
- **375 isolated node(s):** `eslintConfig`, `nextConfig`, `name`, `version`, `private` (+370 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `getSupabaseServerEnv()` connect `getSupabaseServerEnv` to `mandate-ocr.ts`, `stops/[id]/route.ts`, `review-package/route.ts`, `verifyMember`, `relocate/route.ts`, `supabase-auth.ts`, `adminHeaders`, `history/route.ts`, `vehicles/route.ts`, `health/route.ts`, `auth/route.ts`, `drivers/[id]/route.ts`, `drivers/route.ts`, `deliveries/route.ts`, `branches/route.ts`, `supabase-env.ts`, `team/route.ts`, `reorder/route.ts`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **Why does `adminHeaders()` connect `adminHeaders` to `mandate-ocr.ts`, `stops/[id]/route.ts`, `review-package/route.ts`, `verifyMember`, `relocate/route.ts`, `supabase-auth.ts`, `history/route.ts`, `vehicles/route.ts`, `health/route.ts`, `auth/route.ts`, `drivers/[id]/route.ts`, `drivers/route.ts`, `deliveries/route.ts`, `getSupabaseServerEnv`, `branches/route.ts`, `supabase-env.ts`, `team/route.ts`, `reorder/route.ts`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Why does `verifyMember()` connect `verifyMember` to `mandate-ocr.ts`, `stops/[id]/route.ts`, `review-package/route.ts`, `relocate/route.ts`, `supabase-auth.ts`, `adminHeaders`, `history/route.ts`, `vehicles/route.ts`, `auth/route.ts`, `drivers/[id]/route.ts`, `drivers/route.ts`, `deliveries/route.ts`, `getSupabaseServerEnv`, `branches/route.ts`, `supabase-env.ts`, `team/route.ts`, `reorder/route.ts`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **What connects `eslintConfig`, `nextConfig`, `name` to the rest of the system?**
  _375 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `mandate-ocr.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07013574660633484 - nodes in this community are weakly interconnected._
- **Should `workspace.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.0531986531986532 - nodes in this community are weakly interconnected._
- **Should `delivery-planner.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.07051282051282051 - nodes in this community are weakly interconnected._