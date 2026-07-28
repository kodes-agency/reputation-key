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
// Verified against live e2e traffic 2026-07-28 (BQC-6.2): with the placeholder
// RESEND_API_KEY the email send fails SERVER-SIDE but the endpoints still
// return 200 (better-auth runs the send as a background task; TanStack Start
// serializes server-fn throws into 200 payloads). The tolerated signal is
// therefore NOT an HTTP status — it is (a) an intermittent dev-server
// `[Server]` console-forward of the server-side email error log, and (b) for
// the invite flow a deterministic 'Internal server error' pageerror from the
// unawaited form.handleSubmit() pattern (the mutation error is shown in the
// banner the spec accepts; the rejection itself escapes unhandled).

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
    id: 'reset-password-email-placeholder-console',
    kind: 'console-error',
    pattern:
      /\[Server\].*ERROR \[Better Auth\]: Failed to run background task.*EmailError/,
    pagePattern: /\/reset-password/,
    owner: 'engineering',
    reason:
      'CI placeholder RESEND_API_KEY — real email unavailable in e2e. The reset ' +
      'request succeeds (200) and the send fails in a server-side background ' +
      'task; the dev server intermittently forwards that server log to the ' +
      'browser console. BQC-6.7 replaces this with the fake mail outbox.',
    expires: '2026-10-26',
  },
  {
    id: 'member-invitation-email-placeholder-console',
    kind: 'console-error',
    pattern:
      /\[Server\].*ERROR \[Better Auth\]: Failed to run background task.*EmailError/,
    pagePattern: /\/settings\/members/,
    owner: 'engineering',
    reason:
      'CI placeholder RESEND_API_KEY — real email unavailable in e2e. The ' +
      'invite send fails server-side; the dev server intermittently forwards ' +
      'that server log to the browser console. member-invitation.spec.ts ' +
      'already accepts the error banner. BQC-6.7 replaces this with the fake ' +
      'mail outbox.',
    expires: '2026-10-26',
  },
  {
    id: 'member-invitation-email-placeholder-pageerror',
    kind: 'pageerror',
    pattern: /^Internal server error ?$/,
    pagePattern: /\/settings\/members/,
    owner: 'engineering',
    reason:
      'CI placeholder RESEND_API_KEY — the tolerated invite-email failure ' +
      'surfaces as an unhandled rejection: forms call form.handleSubmit() ' +
      'unawaited and the mutation rejects after rendering the error banner ' +
      'the spec accepts. Scoped to this page because the generic message ' +
      'would otherwise hide real server-fn failures elsewhere. BQC-6.7 ' +
      'removes the underlying failure; the handleSubmit pattern is a ' +
      'follow-up for the forms hardening pass.',
    expires: '2026-10-26',
  },
]
