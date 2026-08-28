import type { RegionMoveRecord } from '../../domain/region-move-workflow'

export type RegionMoveAuditEntry = Readonly<{
  actorUserId: string
  organizationId: string
  propertyId: string
  action: 'policy.region.move.request'
  decision: 'allow' | 'deny'
  reason: string
}>

/** Audit-only path for a request that changed no Property state. */
export type RegionMoveAuditWriter = (entry: RegionMoveAuditEntry) => Promise<void>

export type RegionMoveRequestCommitOutcome = 'recorded' | 'active_move_exists'

/**
 * Accepted region-move request authority. The production adapter must commit
 * the machine row and its required content-free operator decision together.
 */
export type RegionMoveRequestCommandStore = Readonly<{
  recordRequest: (
    command: Readonly<{
      move: RegionMoveRecord
      audit: RegionMoveAuditEntry & Readonly<{ decision: 'allow' }>
    }>,
  ) => Promise<RegionMoveRequestCommitOutcome>
}>
