// Compatibility endpoint for the frontend contract. The implementation lives
// in review-package so both URLs share the exact same authorization, audit and
// idempotency behaviour.
export { POST } from "../review-package/route";

// Next.js requires segment configuration to be declared directly in the route
// module; re-exporting it prevents Turbopack from statically analysing it.
export const runtime = "nodejs";
