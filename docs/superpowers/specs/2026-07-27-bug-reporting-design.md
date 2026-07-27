# Bug reporting — design

## Problem

There's no way for a team member to flag a problem in FlotaFlow without
messaging Filip directly. Reports need to land somewhere Filip (admin)
can actually see and triage them, without leaking to non-admin users.

## Data model

New table `bug_reports`:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, pk | |
| `organization_id` | uuid, fk → organizations | |
| `reporter_id` | uuid, fk → auth.users | |
| `reporter_email` | text | denormalized for display without a join |
| `description` | text | required, free text |
| `context` | text | auto-captured: active view name, and case id if one was open |
| `status` | enum: `nowe` \| `w_trakcie` \| `rozwiazane` | default `nowe` |
| `created_at` / `updated_at` | timestamptz | |

RLS: any org member can `insert`. Only `admin` can `select` or `update`
(status changes). This mirrors the existing `has_org_role` / `is_org_member`
helper pattern already used for `mandate_documents`.

We use a new table rather than repurposing `audit_events`: audit events
are an immutable log, not a mutable-status queue, and mixing the two
concepts would make both harder to reason about.

## API

- `POST /api/bug-reports` — any authenticated member creates a report.
- `GET /api/bug-reports` — admin only, lists reports newest first.
- `PATCH /api/bug-reports/[id]` — admin only, updates `status`.

All three follow the existing `verifyMember` convention used across
`/api/documents*`.

## UI

**Report button**: a small floating button, same visual pattern as the
existing desktop/mobile view toggle, rendered inside `AuthGate` (not
`workspace.tsx`) so it's present on every screen including the mobile
scanner, which is a separate component tree. Opens a modal with a single
required textarea (visible label, not placeholder-only) and a submit
button that shows a loading state, then a success confirmation, then
closes. The user does not manually enter context — active view and open
case (if any) are captured automatically.

**Błędy tab**: new sidebar item in `workspace.tsx`, rendered only when
`account.role === "admin"` (role already fetched into state for the
account settings panel). Shows a flat list: description, reporter +
timestamp + context, and a status badge (color **and** text, not
color-only) with an inline dropdown to change status without a separate
detail screen.

## Out of scope for this pass

- Severity/priority field — description is enough to triage manually
  for now.
- Email/Slack notification on new report — the tab is enough until
  report volume justifies push notifications.
- Screenshot attachment.
