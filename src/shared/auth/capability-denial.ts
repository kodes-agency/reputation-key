// Dark-capability denial detection (BQC-6.7 / F-PEOPLE).
//
// When a non-core capability is deliberately dark for an org (the beta
// posture: portal.read, goal.use, … deny with `org_not_allowlisted`), server
// functions throw a ServerFunctionError with the capability deny reason as
// `.code` (see execution-policy.ts requireExecutionAllowed). An ENABLED
// surface that embeds one dark query (the People page's portals query) must
// degrade on exactly these deliberate postures — while REAL errors (DB down,
// internal_error, validation) still fail.
//
// `.code` survives both call paths: SSR loaders see the ServerFunctionError
// instance; client-side navigations see the seroval-deserialized shape (the
// `(e as { code }).code` pattern from routes/_authenticated.tsx).

/** Deny reasons meaning "this capability is deliberately off for you" — the
 * beta-dark family (beta-capabilities.ts CapabilityDenyReason). Suspension,
 * missing/unknown policy, and anything untagged are NOT here: those are real
 * signals and must keep failing. */
const DARK_CAPABILITY_DENIAL_CODES: ReadonlySet<string> = new Set([
  'capability_disabled',
  'capability_blocked',
  'org_not_allowlisted',
  'property_not_allowlisted',
])

/** True when `e` is a server-fn error carrying a dark-capability deny reason. */
export function isDarkCapabilityDenial(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  const code = (e as { code?: unknown }).code
  return typeof code === 'string' && DARK_CAPABILITY_DENIAL_CODES.has(code)
}
