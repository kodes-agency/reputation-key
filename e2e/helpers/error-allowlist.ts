// BQC-6.2 — error-detection allowlist.
//
// This list is for KNOWN BENIGN output only — never for hiding failures.
// An entry says "this specific signal, from this specific cause, is understood
// and accepted for a limited time". It is not a mechanism to make a red suite
// green: if a real regression matches an entry here, the entry is wrong and
// must be deleted, not widened.
//
// Every entry is REQUIRED to carry:
//   - owner:   who accounts for the underlying cause,
//   - reason:  why the signal is benign and what removes it,
//   - expires: ISO date (YYYY-MM-DD). The harness (error-detection.ts) refuses
//     to match against expired entries — a stale exception turns back into a
//     failure instead of silently persisting. Keep horizons short (~90 days).
//
// Verified against live e2e traffic 2026-07-28 (BQC-6.2). BQC-6.7 note: the
// three placeholder-RESEND_API_KEY entries (reset/invite console echoes and
// the invite pageerror) were DELETED — the fake mail outbox
// (e2e/fixtures/mail-stub.ts via RESEND_BASE_URL) removed the underlying
// failures, so the tolerances would now only hide real regressions.

export type AllowlistEntry = Readonly<{
  /** Stable identifier for reports and review (kebab-case). */
  id: string
  /** Which detection channel the entry applies to. */
  kind: 'console-error' | 'mutation-status' | 'pageerror'
  /**
   * console-error: matched against the console message text.
   * mutation-status: matched against the full request URL (including query).
   * pageerror: matched against the uncaught error's message.
   * String entries match by substring; RegExp entries by test().
   */
  pattern: RegExp | string
  /**
   * Extra scope: matched against the URL of the PAGE the signal fired on.
   * REQUIRED for pageerror entries (an unscoped pageerror exception would
   * hide uncaught errors suite-wide); optional additional scoping for the
   * other kinds.
   */
  pagePattern?: RegExp | string
  /**
   * mutation-status only: which HTTP statuses the entry tolerates
   * (number, or RegExp tested against the status string, e.g. /^4\d\d$/).
   * Required for mutation-status entries — an entry that tolerates ANY
   * non-2xx status on an endpoint is too broad to accept.
   */
  status?: RegExp | number
  owner: string
  reason: string
  /** ISO date (YYYY-MM-DD). The entry suppresses through end of that day (UTC). */
  expires: string
}>

export const ERROR_ALLOWLIST: readonly AllowlistEntry[] = [
  {
    id: 'guest-portal-denied-ssr-status-console',
    kind: 'console-error',
    pattern: 'Failed to load resource: the server responded with a status of 500',
    pagePattern: /\/p\/[^/?#]+\/[^/?#]+/,
    owner: 'engineering',
    reason:
      'BQC-6.6: a dark public portal (portal.read off) denies in the loader; ' +
      'the /p route errorComponent intentionally renders PortalUnavailable ' +
      '(asserted directly by dark-promotion.spec.ts), but SSR still answers ' +
      'the document with the error status (500) and Chromium echoes that ' +
      'status to the console. The tolerated signal is only the browser echo ' +
      'of the deliberate error-boundary SSR status on the two-segment public ' +
      'portal path — the UX, the zero-mutation proof, and the server-side ' +
      'error log all still gate. Follow-up: a non-500 status for the public ' +
      'deny path (route-level status semantics) removes this entry.',
    expires: '2026-10-27',
  },
  {
    id: 'guest-portal-denied-react-boundary-console',
    kind: 'console-error',
    pattern: 'The above error occurred in the <MatchInnerImpl> component',
    pagePattern: /\/p\/[^/?#]+\/[^/?#]+/,
    owner: 'engineering',
    reason:
      'BQC-6.6: sibling of guest-portal-denied-ssr-status-console — same ' +
      'deliberate /p error boundary, second echo. When the client router ' +
      're-runs the denied loader after hydration, MatchInnerImpl rethrows the ' +
      'dehydrated loader error and React DEV logs its standard error-boundary ' +
      'notice before rendering the intentional PortalUnavailable (asserted ' +
      'directly by dark-promotion.spec.ts). Dev-only React output for the ' +
      'intended boundary on the two-segment public portal path; whether the ' +
      'client revalidates post-hydration is timing-dependent, hence ' +
      'intermittent. Removed by the same status-semantics follow-up.',
    expires: '2026-10-27',
  },
]
