// Identity's executor for the manual rights script: erasure of one Staff
// Participant (scope participant) by the SHA-256 of a verified identifier.
//
// Ids are journaled in batches of at most RIGHTS_BATCH_MAX before each batch's
// transaction opens, so a failed journal write changes nothing. The erasure
// itself lives in staff-participant-erasure.ts and is shared with the replayer.

import type { Database } from '#/shared/db'
import type { RightsExecutor } from '#/shared/ops/rights/rights-executor'
import type { RightsJournal } from '#/shared/ops/rights/rights-journal'
import { RIGHTS_BATCH_MAX } from '#/shared/ops/rights/rights-request-command'
import {
  eraseStaffParticipants,
  resolveStaffParticipantIds,
  staffParticipantLogins,
  type StaffParticipantErasure,
} from './staff-participant-erasure'

export type StaffParticipantRightsDeps = Readonly<{
  db: Database
  journal: RightsJournal
  now: () => Date
}>

/** The Staff rows a participant erasure pseudonymises or removes, with their logins. */
const STAFF_PARTICIPANT_TABLES = Object.freeze([
  'staff_participants',
  'staff_participations',
  'staff_user_links',
  'staff_onboardings',
  'portal_responsibilities',
  'property_access_grant',
  'merchant_ai_notice_update_receipts',
  'product_update_settings',
  'product_update_receipts',
  'invitation',
  'member',
  'verification',
  'session',
  'account',
  'user',
])

const NO_MATCH = 'no Staff Participant in this Organization matches subject-ref'

function batchesOf<T>(
  items: ReadonlyArray<T>,
  size: number,
): ReadonlyArray<ReadonlyArray<T>> {
  const batches: Array<ReadonlyArray<T>> = []
  for (let start = 0; start < items.length; start += size) {
    batches.push(items.slice(start, start + size))
  }
  return batches
}

export function createStaffParticipantRightsExecutor(
  deps: StaffParticipantRightsDeps,
): RightsExecutor {
  const resolve = (organizationId: string, subjectRef: string | undefined) =>
    subjectRef
      ? deps.db.transaction((tx) =>
          resolveStaffParticipantIds(tx, organizationId, subjectRef),
        )
      : Promise.resolve([])
  return Object.freeze({
    name: 'staff-participant',
    scopes: ['participant'] as const,
    tables: { participant: STAFF_PARTICIPANT_TABLES },
    // Every batch writes its own entry naming its ids; a scope-level entry could
    // not be replayed.
    journalContexts: [] as const,
    async preflight(plan) {
      const journalError = deps.journal.check(plan, ['staff'])
      if (journalError) return { ok: false, error: journalError }
      const ids = await resolve(plan.organizationId, plan.subjectRef)
      return ids.length === 0 ? { ok: false, error: NO_MATCH } : { ok: true }
    },
    async report(plan) {
      const ids = await resolve(plan.organizationId, plan.subjectRef)
      if (ids.length === 0) return [NO_MATCH]
      const logins = await deps.db.transaction((tx) =>
        staffParticipantLogins(tx, plan.organizationId, ids),
      )
      return [
        `participants=${ids.length} logins=${logins.all.length} ` +
          `logins-kept-for-other-organizations=${logins.kept.length}`,
      ]
    },
    exportFiles: async () => [],
    async apply(plan) {
      const at = plan.verifiedAt ?? plan.receivedAt ?? deps.now()
      const ids = await resolve(plan.organizationId, plan.subjectRef)
      if (ids.length === 0) return { ok: false, error: NO_MATCH }
      const size = Math.max(1, Math.min(plan.batchSize, RIGHTS_BATCH_MAX))
      let sums: StaffParticipantErasure = { participants: 0, logins: 0, memberships: 0 }
      for (const batch of batchesOf(ids, size)) {
        const done = await deps.journal.runBatch(
          plan,
          'staff',
          { kind: 'staff_participant', ids: batch },
          () =>
            deps.db.transaction((tx) =>
              eraseStaffParticipants(tx, {
                organizationId: plan.organizationId,
                participantIds: batch,
                at,
              }),
            ),
        )
        sums = {
          participants: sums.participants + done.participants,
          logins: sums.logins + done.logins,
          memberships: sums.memberships + done.memberships,
        }
      }
      return {
        ok: true,
        lines: [
          `participants=${sums.participants} logins=${sums.logins} memberships=${sums.memberships}`,
        ],
      }
    },
  })
}
