# Procesor Mandatów / FlotaFlow

Next.js 16 + React 19 + TypeScript, Supabase (auth/DB/storage, RLS by role), Google Document AI (OCR) + Route Optimization API via Vercel OIDC Workload Identity Federation. Deployed on Vercel: procesor-mandatow.vercel.app.

## Working with another agent on this repo

Filip runs both Claude Code and Codex on this repo, not always at the same time, and doesn't want to manually re-explain context between us. Treat the other agent's prior work as a teammate's, not a stranger's PR.

- **Before starting work**, read `.agents/log.md` — at least the last few entries — to see what the other agent did recently, any open questions it left, or anything it flagged in your code.
- **After finishing a chunk of work** (a fix, a feature, a review finding), append a new entry to `.agents/log.md`. Write enough context that the other agent can act on it without Filip re-explaining — file paths, what changed, why, what still needs verification.
- If you review the other agent's code and find something questionable, log it there rather than assuming Filip will relay it verbatim — he might not have the technical detail to reproduce your point exactly.
- Don't treat `.agents/log.md` as scratch space or a full transcript — short, decision-focused entries. Never put secrets/keys in it (it's committed to git).

Entry format:
```
## YYYY-MM-DD HH:MM — <Claude|Codex> — <short title>
- what changed / what you found
- why (if not obvious)
- anything the other agent or Filip should double-check
```
