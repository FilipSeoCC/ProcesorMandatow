// Compatibility endpoint for the frontend contract. The implementation lives
// in review-package so both URLs share the exact same authorization, audit and
// idempotency behaviour.
//
// `runtime` must be re-declared (not re-exported) — Next.js statically parses
// route config exports per-file and rejects a re-exported `runtime` binding.
export { POST } from "../review-package/route";
export const runtime = "nodejs";
