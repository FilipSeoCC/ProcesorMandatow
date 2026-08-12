# Procesor Mandatów / FlotaFlow

Next.js 16 + React 19 + TypeScript, Supabase (auth/DB/storage, RLS by role), Google Document AI (OCR) + Route Optimization API via Vercel OIDC Workload Identity Federation. Deployed on Vercel: procesor-mandatow.vercel.app.

**New here? Read [`docs/stan-projektu.md`](docs/stan-projektu.md) first** — what the product is and who it's for, what works, what is broken or unfinished, the traps that have already cost time (assignment history, plate normalization, manual schema application), and what to do next. Then come back here for the working agreement, and read `.agents/log.md` for the chronological detail.

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

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` before committing (AST-only, no API cost). Commit the portable `graphify-out/` files together with the code so Codex and Claude receive the same graph after pulling the branch.
- Do not commit Graphify caches, backups, `graph.html`, `.graphify_python`, `.graphify_root` or local hook configuration; these remain machine-specific. On a new clone run `graphify hook install` once.
