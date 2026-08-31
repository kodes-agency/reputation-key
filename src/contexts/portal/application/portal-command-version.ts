/**
 * Returns a command timestamp that is strictly newer than the revision read by
 * the caller. PostgreSQL timestamps are the Portal command concurrency fence,
 * so equal or regressed wall-clock values must not reuse the prior revision.
 */
export function nextPortalCommandAt(observedAt: Date, expectedAt: Date): Date {
  return observedAt.getTime() > expectedAt.getTime()
    ? observedAt
    : new Date(expectedAt.getTime() + 1)
}
