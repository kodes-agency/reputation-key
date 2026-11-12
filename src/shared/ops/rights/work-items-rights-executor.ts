// The platform's executor for the manual rights script: an Organization's
// closure deletes its durable work items, which name the operator who retried,
// cancelled or discarded one and the reason they gave.
//
// Work still to do is not erased underneath its handler: apply refuses while
// any item is pending, running, uncertain or quarantined. An unsettled outbox
// event refuses too, because outbox delivery admits an event again once its
// work item is gone. Settled events stay with their own 30-day retention and
// are never admitted again.

import type { Database } from '#/shared/db'
import {
  isOrganizationSuspended,
  ORGANIZATION_NOT_SUSPENDED,
} from '#/shared/db/lifecycle/assert-organization-held'
import type { BackupErasureReplayer } from '#/shared/db/lifecycle/backup-erasure-ledger'
import {
  deleteWorkItems,
  deleteWorkItemsInTx,
  readWorkItemsFootprint,
  type WorkItemsFootprint,
} from '#/shared/db/lifecycle/work-items-rights-store'
import type { RightsExecutor } from './rights-executor'

const CONTEXT = 'platform'

function refusalFor(organizationId: string) {
  return (held: WorkItemsFootprint): string | null => {
    if (!isOrganizationSuspended(organizationId)) return ORGANIZATION_NOT_SUSPENDED
    if (held.unfinished > 0 || held.unsettledEvents > 0) {
      return `work items are not ready to erase (unfinished_work_items=${held.unfinished} unsettled_outbox_events=${held.unsettledEvents})`
    }
    return null
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unexpected error'
}

export function createWorkItemsRightsExecutor(db: Database): RightsExecutor {
  return Object.freeze({
    name: 'work-items',
    scopes: ['organization'] as const,
    tables: { organization: ['work_items'] },
    journalContexts: [CONTEXT] as const,
    async preflight(plan) {
      const held = await readWorkItemsFootprint(db, plan.organizationId)
      const refusal = refusalFor(plan.organizationId)(held)
      return refusal ? { ok: false, error: refusal } : { ok: true }
    },
    async report(plan) {
      const held = await readWorkItemsFootprint(db, plan.organizationId)
      return [
        `work_items ${held.items}`,
        `erasure blockers: unfinished_work_items=${held.unfinished} unsettled_outbox_events=${held.unsettledEvents}`,
      ]
    },
    exportFiles: async () => [],
    async apply(plan) {
      try {
        const rows = await deleteWorkItems(
          db,
          plan.organizationId,
          refusalFor(plan.organizationId),
        )
        return {
          ok: true,
          lines: [`erasure record org=${plan.organizationId} rows=${rows}`],
        }
      } catch (error) {
        return { ok: false, error: errorMessage(error) }
      }
    },
  })
}

/** Repeats the deletion for an Organization a restore brought back. */
export const workItemsErasureReplayer: BackupErasureReplayer = Object.freeze({
  context: CONTEXT,
  subjectClass: 'organization',
  reErase: (tx, entry) => deleteWorkItemsInTx(tx, entry.organizationId),
})
