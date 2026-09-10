/**
 * Domain-event dispatch retry policy.
 *
 * Jobs on this queue are event-typed rather than job-catalogue-typed, so every
 * producer of a canonical or accelerated delivery must use this contract.
 * Eight attempts are required because Review Analysis can consume pre-provider
 * retries and only terminal-settles a provider failure on its fourth attempt.
 * The 15-minute domain horizon remains the terminal authority: the minimum
 * exponential delay puts attempt seven after that horizon, with one attempt to
 * spare. This budget is recovery, not ordering; the backfill chain wakes N+1
 * when N settles instead of waiting for these retries to align by chance.
 */
export const DISPATCH_JOB_OPTIONS = {
  attempts: 8,
  backoff: { type: 'exponential', delay: 30_000, jitter: 0.5 },
} as const
