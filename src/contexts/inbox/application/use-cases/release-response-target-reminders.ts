import { reviewId, type OrganizationId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import {
  REMINDER_GOOGLE_CHECK_DELAY_CAP_MS,
  decideReminderAfterGoogleCheck,
  planReminderRelease,
  type ReminderGoogleCheckOutcome,
  type ReminderReplyHead,
} from '../../domain/reminder-release'
import type {
  GoogleReviewCheckOutcome,
  GoogleReviewCheckPort,
} from '../ports/google-review-check.port'
import type { ReplyLookupPort } from '../ports/reply-lookup.port'
import type {
  DueReminderCandidate,
  ResponseTargetStore,
} from '../ports/response-target.store'

export const RESPONSE_TARGET_REMINDER_RELEASE_LIMIT = 100
/** Google reads one tick may spend; the rest wait for the next tick. */
export const RESPONSE_TARGET_REMINDER_GOOGLE_READ_CAP = 20
/**
 * Soft budget for one tick's Google reads, well inside the job's 120 s
 * timeout: it is checked before each read, so one slow read can overrun it by
 * the adapter's own 30 s deadline but never starts another.
 */
export const RESPONSE_TARGET_REMINDER_TICK_BUDGET_MS = 35_000

/** Content-free counts for the job log. */
export type ReminderReleaseCounts = Readonly<{
  /** Reminder facts queued (a superseded halfway, which has none, is not counted). */
  released: number
  /** Google reads attempted. */
  checked: number
  /** Held on a reply Review already knew, with no read. */
  heldLocal: number
  /** Held on a reply the read just showed. */
  heldAfterRead: number
  /** Left pending for the next tick: Google unreadable or the tick's limits spent. */
  deferred: number
  /** Reads that failed, transient or permanent. */
  unavailable: number
  /** Reads skipped because this environment has no Google provider. */
  skippedNoProvider: number
  /** Slots whose own work threw; they stay pending. */
  failed: number
}>

const NO_COUNTS: ReminderReleaseCounts = Object.freeze({
  released: 0,
  checked: 0,
  heldLocal: 0,
  heldAfterRead: 0,
  deferred: 0,
  unavailable: 0,
  skippedNoProvider: 0,
  failed: 0,
})

const add = (
  total: ReminderReleaseCounts,
  delta: Partial<ReminderReleaseCounts>,
): ReminderReleaseCounts => ({
  released: total.released + (delta.released ?? 0),
  checked: total.checked + (delta.checked ?? 0),
  heldLocal: total.heldLocal + (delta.heldLocal ?? 0),
  heldAfterRead: total.heldAfterRead + (delta.heldAfterRead ?? 0),
  deferred: total.deferred + (delta.deferred ?? 0),
  unavailable: total.unavailable + (delta.unavailable ?? 0),
  skippedNoProvider: total.skippedNoProvider + (delta.skippedNoProvider ?? 0),
  failed: total.failed + (delta.failed ?? 0),
})

export type ReleaseDueResponseTargetRemindersDeps = Readonly<{
  targetStore: Pick<
    ResponseTargetStore,
    'listDueReminderCandidates' | 'releaseReminderSlot'
  >
  replyLookup: Pick<ReplyLookupPort, 'getGoogleReplyHeadsByReviewIds'>
  googleReviewCheck: GoogleReviewCheckPort
  clock: () => Date
  logger: Pick<LoggerPort, 'warn'>
}>
export type ReleaseDueResponseTargetRemindersInput = void
export type ReleaseDueResponseTargetReminders = ReturnType<
  typeof releaseDueResponseTargetReminders
>

type Heads = ReadonlyMap<string, ReminderReplyHead>

/** A failure that stays with its slot: count it, log its class, never its text. */
const slotFailed = (
  deps: ReleaseDueResponseTargetRemindersDeps,
  stage: string,
  error: unknown,
): Partial<ReminderReleaseCounts> => {
  deps.logger.warn(
    { stage, errorName: error instanceof Error ? error.name : 'non_error' },
    'Response Target reminder slot left pending after an error',
  )
  return { failed: 1 }
}

/** Phase 3 for one slot: its own short transaction, never batched. */
const releaseSlot = async (
  deps: ReleaseDueResponseTargetRemindersDeps,
  candidate: DueReminderCandidate,
  now: Date,
): Promise<Partial<ReminderReleaseCounts>> => {
  try {
    const result = await deps.targetStore.releaseReminderSlot({ key: candidate.key, now })
    return result === 'released' ? { released: 1 } : {}
  } catch (error) {
    return slotFailed(deps, 'release', error)
  }
}

/**
 * The reply heads Review holds for the Google review slots, one lookup per
 * Organization. An Organization whose lookup fails is reported, so its slots
 * stay pending instead of being decided without their heads.
 */
const loadHeads = async (
  deps: ReleaseDueResponseTargetRemindersDeps,
  candidates: ReadonlyArray<DueReminderCandidate>,
): Promise<Readonly<{ heads: Heads; unreadableOrganizations: ReadonlySet<string> }>> => {
  const byOrganization = new Map<OrganizationId, ReturnType<typeof reviewId>[]>()
  for (const candidate of candidates) {
    if (candidate.targetKind !== 'google_review_response') continue
    byOrganization.set(candidate.organizationId, [
      ...(byOrganization.get(candidate.organizationId) ?? []),
      reviewId(candidate.sourceId),
    ])
  }
  const heads = new Map<string, ReminderReplyHead>()
  const unreadableOrganizations = new Set<string>()
  for (const [organization, reviewIds] of byOrganization) {
    try {
      const found = await deps.replyLookup.getGoogleReplyHeadsByReviewIds(
        reviewIds,
        organization,
      )
      for (const [id, head] of found) heads.set(id, head)
    } catch (error) {
      slotFailed(deps, 'heads', error)
      unreadableOrganizations.add(organization)
    }
  }
  return { heads, unreadableOrganizations }
}

const toDecisionOutcome = (
  outcome: GoogleReviewCheckOutcome,
): ReminderGoogleCheckOutcome => {
  switch (outcome.status) {
    case 'read':
      return 'read'
    case 'reply_unreadable':
      return 'reply_unreadable'
    case 'review_missing':
      return 'review_missing'
    case 'not_checkable':
      return 'not_checkable'
    case 'unavailable':
      return outcome.retry === 'never' ? 'permanent_failure' : 'transient_failure'
  }
}

/** One Google read. The port promises not to throw; a thrown one reads as transient. */
const readGoogle = async (
  deps: ReleaseDueResponseTargetRemindersDeps,
  candidate: DueReminderCandidate,
): Promise<GoogleReviewCheckOutcome> => {
  try {
    return await deps.googleReviewCheck.check({
      organizationId: candidate.organizationId,
      propertyId: candidate.propertyId,
      reviewId: reviewId(candidate.sourceId),
    })
  } catch (error) {
    slotFailed(deps, 'check', error)
    return { status: 'unavailable', retry: 'later' }
  }
}

const readCounts = (
  outcome: GoogleReviewCheckOutcome,
): Partial<ReminderReleaseCounts> => ({
  checked: 1,
  ...(outcome.status === 'unavailable' ? { unavailable: 1 } : {}),
  ...(outcome.status === 'not_checkable' && outcome.reason === 'no_provider'
    ? { skippedNoProvider: 1 }
    : {}),
})

/** The head Review holds after the read, or a failure to read it. */
const headAfterRead = async (
  deps: ReleaseDueResponseTargetRemindersDeps,
  candidate: DueReminderCandidate,
): Promise<
  Readonly<{ ok: true; head: ReminderReplyHead | undefined }> | Readonly<{ ok: false }>
> => {
  try {
    const found = await deps.replyLookup.getGoogleReplyHeadsByReviewIds(
      [reviewId(candidate.sourceId)],
      candidate.organizationId,
    )
    return { ok: true, head: found.get(candidate.sourceId) }
  } catch (error) {
    slotFailed(deps, 'heads_after_read', error)
    return { ok: false }
  }
}

/** Read Google for one slot, then hold, defer or release it. */
const checkSlot = async (
  deps: ReleaseDueResponseTargetRemindersDeps,
  candidate: DueReminderCandidate,
): Promise<Partial<ReminderReleaseCounts>> => {
  const outcome = await readGoogle(deps, candidate)
  const counts = readCounts(outcome)
  const after = outcome.status === 'read' ? await headAfterRead(deps, candidate) : null
  if (after?.ok === false) return { ...counts, failed: 1 }
  const now = deps.clock()
  const decision = decideReminderAfterGoogleCheck({
    outcome: toDecisionOutcome(outcome),
    head: after?.head,
    targetStartAt: candidate.targetStartAt,
    cycleMaterialReviewRevision: candidate.sourceRevision,
    scheduledFor: candidate.scheduledFor,
    now,
  })
  if (decision === 'hold') return { ...counts, heldAfterRead: 1 }
  if (decision === 'defer') return { ...counts, deferred: 1 }
  return { ...counts, ...(await releaseSlot(deps, candidate, now)) }
}

/**
 * A slot the tick has no read left for. It waits for the next tick unless it
 * is already as late as the delay cap allows, when it goes out unchecked: a
 * backlog must not hold a reminder back for ever.
 */
const pastReadLimits = async (
  deps: ReleaseDueResponseTargetRemindersDeps,
  candidate: DueReminderCandidate,
): Promise<Partial<ReminderReleaseCounts>> => {
  const now = deps.clock()
  const lateMs = now.getTime() - candidate.scheduledFor.getTime()
  if (lateMs < REMINDER_GOOGLE_CHECK_DELAY_CAP_MS) return { deferred: 1 }
  return releaseSlot(deps, candidate, now)
}

/**
 * One bounded scheduler pass, in three phases so that no transaction or row
 * lock is ever held across Google I/O:
 *
 * 1. list the due slots, with no lock;
 * 2. decide each one, reading Google for the Google-review ones not already
 *    settled locally (at most 20 reads and about 35 s per tick);
 * 3. release each decided slot at once in its own short transaction. The store
 *    re-checks under the target lock, so a slot a reply closed meanwhile is
 *    skipped, not delivered.
 *
 * Private-feedback slots and superseded halfways go first, so a slow Google
 * can never stall them. A per-slot error is counted and logged, never thrown:
 * a throw would make the queue redo phases 1 and 2.
 */
export const releaseDueResponseTargetReminders = (
  deps: ReleaseDueResponseTargetRemindersDeps,
) => {
  return async (): Promise<ReminderReleaseCounts> => {
    const startedAt = deps.clock()
    const candidates = await deps.targetStore.listDueReminderCandidates({
      now: startedAt,
      limit: RESPONSE_TARGET_REMINDER_RELEASE_LIMIT,
    })
    const { heads, unreadableOrganizations } = await loadHeads(deps, candidates)

    const planned = candidates.map((candidate) => ({
      candidate,
      plan: planReminderRelease({
        targetKind: candidate.targetKind,
        reminderKind: candidate.key.reminderKind,
        targetDueAt: candidate.targetDueAt,
        targetStartAt: candidate.targetStartAt,
        cycleMaterialReviewRevision: candidate.sourceRevision,
        now: startedAt,
        head: heads.get(candidate.sourceId),
      }),
    }))

    let counts = NO_COUNTS
    for (const { candidate, plan } of planned) {
      if (plan !== 'release_unchecked') continue
      counts = add(counts, await releaseSlot(deps, candidate, deps.clock()))
    }
    for (const { candidate, plan } of planned) {
      if (plan === 'release_unchecked') continue
      if (unreadableOrganizations.has(String(candidate.organizationId))) {
        counts = add(counts, { failed: 1 })
      } else if (plan === 'hold_local') {
        counts = add(counts, { heldLocal: 1 })
      } else {
        const readsLeft =
          counts.checked < RESPONSE_TARGET_REMINDER_GOOGLE_READ_CAP &&
          deps.clock().getTime() - startedAt.getTime() <
            RESPONSE_TARGET_REMINDER_TICK_BUDGET_MS
        counts = add(
          counts,
          readsLeft
            ? await checkSlot(deps, candidate)
            : await pastReadLimits(deps, candidate),
        )
      }
    }
    return counts
  }
}
