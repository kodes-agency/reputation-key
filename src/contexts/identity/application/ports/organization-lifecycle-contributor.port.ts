import type {
  OrganizationLifecycleContext,
  OrganizationLifecycleReceipt,
  OrganizationLifecycleReceiptPhase,
  OrganizationLifecycleStatus,
} from '../../domain/organization-lifecycle'

// A contributor for a foreign context is a cross-context adapter, and
// src/contexts/CONTEXT.md lets those reach only into application/ports/**. Every
// type named in this port's own signatures is therefore re-exported here:
// otherwise an implementer could not spell its own method signatures without
// importing Identity's domain/, which the boundary rule forbids.
export type {
  OrganizationLifecycleContext,
  OrganizationLifecycleReceipt,
  OrganizationLifecycleReceiptPhase,
  OrganizationLifecycleStatus,
}

export type OrganizationLifecycleContributionInput = Readonly<{
  organizationId: string
  closureLineageId: string
  lifecycleRevision: number
  recoverableUntil: Date
  occurredAt: Date
}>

export type OrganizationLifecycleContributor = Readonly<{
  context: OrganizationLifecycleContext
  /**
   * Each method is idempotent for `(closureLineageId, lifecycleRevision)` and
   * persists its own content-free receipt before returning. A `no_data`
   * outcome is still affirmative evidence, never an omitted contributor.
   */
  prepareClosing(
    input: OrganizationLifecycleContributionInput,
  ): Promise<Omit<OrganizationLifecycleReceipt, 'context' | 'phase'>>
  verifyPurgeReadiness(
    input: OrganizationLifecycleContributionInput,
  ): Promise<Omit<OrganizationLifecycleReceipt, 'context' | 'phase'>>
  purge(
    input: OrganizationLifecycleContributionInput,
  ): Promise<Omit<OrganizationLifecycleReceipt, 'context' | 'phase'>>
}>

export type OrganizationLifecycleSupportAuthorization = Readonly<{
  authorize(input: {
    action: 'waive_recovery' | 'cancel_pending_purge' | 'begin_irreversible_purge'
    organizationId: string
    closureLineageId: string
    expectedRevision: number
    operatorUserId: string
    supportEvidenceRef: string
    authorizationEvidenceRef: string
    occurredAt: Date
  }): Promise<boolean>
}>

export type OrganizationLifecyclePhaseResult = Readonly<{
  phase: OrganizationLifecycleReceiptPhase
  receipts: readonly OrganizationLifecycleReceipt[]
  evidenceRef: string
}>

export function contributionInputFromStatus(
  status: OrganizationLifecycleStatus,
  occurredAt: Date,
): OrganizationLifecycleContributionInput {
  if (!status.closureLineageId || !status.recoverableUntil) {
    throw new Error('Organization closure lineage is incomplete')
  }
  return {
    organizationId: status.organizationId,
    closureLineageId: status.closureLineageId,
    lifecycleRevision: status.revision,
    recoverableUntil: status.recoverableUntil,
    occurredAt,
  }
}
