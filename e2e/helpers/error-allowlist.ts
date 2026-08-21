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
//
// 2026-08-21: `server-fn-fetch-aborted-on-navigation` was DELETED too. It
// tolerated `TypeError: Failed to fetch ... createServerFn` unconditionally,
// which (a) hid a genuinely broken server-fn read whose stack happened to show
// that frame, and (b) described PERMANENT framework behaviour behind a 90-day
// expiry, so it was always going to re-break this gate. The same event is now
// suppressed by evidence in error-detection.ts: a `Failed to fetch` echo spends
// one observed server-function GET abort (net::ERR_ABORTED) or it fails.

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

export const ERROR_ALLOWLIST: readonly AllowlistEntry[] = []
