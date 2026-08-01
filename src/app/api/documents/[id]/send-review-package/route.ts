// Compatibility endpoint for the frontend contract. The implementation lives
// in review-package so both URLs share the exact same authorization, audit and
// idempotency behaviour.
export { POST, runtime } from "../review-package/route";
