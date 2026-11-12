// Dark-capability denial detection (BQC-6.7 / F-PEOPLE).
//
// When a capability is deliberately off (its switch, everything off, or a
// blocked fate deny with `capability_disabled` / `capability_blocked`), server
// functions throw a ServerFunctionError with the capability deny reason as
// `.code` (see execution-policy.ts requireExecutionAllowed). An ENABLED
// surface that embeds one dark query (the Staff page's portals query) must
// degrade on exactly these deliberate postures — while REAL errors (DB down,
// internal_error, validation) still fail.
//
// `.code` survives both call paths: SSR loaders see the ServerFunctionError
// instance; client-side navigations see the seroval-deserialized shape (the
// `(e as { code }).code` pattern from routes/_authenticated.tsx).

/** Deny reasons meaning "this capability is deliberately off" (beta-capabilities.ts
 * CapabilityDenyReason). Suspension and anything untagged are NOT here: those
 * are real signals and must keep failing. */
const DARK_CAPABILITY_DENIAL_CODES: ReadonlySet<string> = new Set([
  'capability_disabled',
  'capability_blocked',
])

/** True when `e` is a server-fn error carrying a dark-capability deny reason. */
export function isDarkCapabilityDenial(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  const code = (e as { code?: unknown }).code
  return typeof code === 'string' && DARK_CAPABILITY_DENIAL_CODES.has(code)
}
