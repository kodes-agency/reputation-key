import type { RecentActivityRecoveryCursor } from '../ports/activity-recovery-store.port'

export type RecentActivityRecoveryInvocation = Readonly<{
  observedAt: Date
  after?: RecentActivityRecoveryCursor
}>

const validDate = (value: string): Date | null => {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * Parse the non-secret positional portion of the operator command. Requiring
 * an explicit observation time keeps readiness reports comparable; a cursor
 * is accepted only as the complete pair emitted by a previous bounded run.
 */
export function parseRecentActivityRecoveryInvocation(
  positionals: ReadonlyArray<string>,
): RecentActivityRecoveryInvocation {
  if (positionals.length !== 1 && positionals.length !== 3) {
    throw new Error(
      'expected <observed-at> or <observed-at> <after-occurred-at> <after-replay-key>',
    )
  }

  const observedAt = validDate(positionals[0] as string)
  if (!observedAt) throw new Error('observed-at must be a valid ISO-8601 value')

  if (positionals.length === 1) return { observedAt }

  const sourceOccurredAt = validDate(positionals[1] as string)
  if (!sourceOccurredAt) {
    throw new Error('after-occurred-at must be a valid ISO-8601 value')
  }
  if (sourceOccurredAt.getTime() > observedAt.getTime()) {
    throw new Error('the recovery cursor cannot be newer than observed-at')
  }
  const replayKey = (positionals[2] as string).trim()
  if (replayKey.length < 1 || replayKey.length > 512) {
    throw new Error('after-replay-key must contain between 1 and 512 characters')
  }

  return { observedAt, after: { sourceOccurredAt, replayKey } }
}
