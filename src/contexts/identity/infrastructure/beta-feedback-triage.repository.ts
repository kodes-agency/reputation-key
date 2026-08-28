import { and, asc, eq, ne, or } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  betaFeedbackTriage,
  betaFeedbackTriageTransitions,
} from '#/shared/db/schema/beta-feedback-triage.schema'
import type {
  BetaFeedbackRouteKey,
  BetaFeedbackViewport,
} from '#/shared/beta-feedback-contract'
import {
  assertBetaFeedbackTriageTransition,
  type BetaFeedbackTriageSnapshot,
  type BetaFeedbackTriageState,
  type BetaFeedbackTriageTransition,
} from '../domain/betaFeedbackTriage'

type TriageRow = typeof betaFeedbackTriage.$inferSelect
type TriageTransitionRow = typeof betaFeedbackTriageTransitions.$inferSelect

export type PreparedBetaFeedbackTriage = Readonly<{
  reference: string
  organizationPseudonym: string
  actorPseudonym: string
  feedbackType: 'bug' | 'suggestion'
  impactCode:
    | 'cannot_complete'
    | 'workaround_available'
    | 'small_issue'
    | 'important'
    | 'helpful'
    | 'nice_to_have'
  routeKey: BetaFeedbackRouteKey
  viewport: BetaFeedbackViewport
  reporterRole: 'AccountAdmin' | 'PropertyManager' | 'Staff'
  attachmentKind: 'none' | 'masked_layout_v1'
  attachmentCapturedAt: Date | null
  attachmentExpiresAt: Date | null
  now: Date
}>

export type BetaFeedbackTriageRecord = BetaFeedbackTriageSnapshot &
  Readonly<{
    organizationPseudonym: string
    actorPseudonym: string
    feedbackType: 'bug' | 'suggestion'
    impactCode: PreparedBetaFeedbackTriage['impactCode']
    routeKey: BetaFeedbackRouteKey
    viewport: BetaFeedbackViewport
    reporterRole: PreparedBetaFeedbackTriage['reporterRole']
    deliveryFailureCode: string | null
    providerReference: string | null
    attachmentKind: PreparedBetaFeedbackTriage['attachmentKind']
    attachmentCapturedAt: Date | null
    attachmentExpiresAt: Date | null
    createdAt: Date
    updatedAt: Date
  }>

export type BetaFeedbackTriageQueueItem = Omit<
  BetaFeedbackTriageRecord,
  'organizationPseudonym' | 'actorPseudonym' | 'ownerPseudonym' | 'providerReference'
>

function queueItem(row: TriageRow): BetaFeedbackTriageQueueItem {
  const {
    organizationPseudonym: _organization,
    actorPseudonym: _actor,
    ...item
  } = record(row)
  const { ownerPseudonym: _owner, providerReference: _provider, ...safeItem } = item
  return safeItem
}

function record(row: TriageRow): BetaFeedbackTriageRecord {
  return {
    reference: row.reference,
    organizationPseudonym: row.organizationPseudonym,
    actorPseudonym: row.actorPseudonym,
    feedbackType: row.feedbackType as BetaFeedbackTriageRecord['feedbackType'],
    impactCode: row.impactCode as BetaFeedbackTriageRecord['impactCode'],
    routeKey: row.routeKey as BetaFeedbackRouteKey,
    viewport: row.viewport as BetaFeedbackViewport,
    reporterRole: row.reporterRole as BetaFeedbackTriageRecord['reporterRole'],
    deliveryState: row.deliveryState as BetaFeedbackTriageRecord['deliveryState'],
    deliveryFailureCode: row.deliveryFailureCode,
    providerReference: row.providerReference,
    attachmentKind: row.attachmentKind as BetaFeedbackTriageRecord['attachmentKind'],
    attachmentCapturedAt: row.attachmentCapturedAt,
    attachmentExpiresAt: row.attachmentExpiresAt,
    triageState: row.triageState as BetaFeedbackTriageState,
    severity: row.severity as BetaFeedbackTriageRecord['severity'],
    privacyClass: row.privacyClass as BetaFeedbackTriageRecord['privacyClass'],
    securityClass: row.securityClass as BetaFeedbackTriageRecord['securityClass'],
    reproduction: row.reproduction as BetaFeedbackTriageRecord['reproduction'],
    dedupeDisposition:
      row.dedupeDisposition as BetaFeedbackTriageRecord['dedupeDisposition'],
    duplicateOfReference: row.duplicateOfReference,
    ownerQueue: row.ownerQueue as BetaFeedbackTriageRecord['ownerQueue'],
    ownerPseudonym: row.ownerPseudonym,
    customerResponse:
      row.customerResponse as BetaFeedbackTriageRecord['customerResponse'],
    engineeringIssueRef: row.engineeringIssueRef,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function requireUpdated(rows: readonly TriageRow[], operation: string): TriageRow {
  const row = rows[0]
  if (!row) throw new Error(`Beta feedback ${operation} revision is stale`)
  return row
}

function isExactTransitionReplay(
  row: TriageTransitionRow,
  input: Readonly<{
    reference: string
    operatorPseudonym: string
    transition: BetaFeedbackTriageTransition
  }>,
): boolean {
  const transition = input.transition
  return (
    row.feedbackReference === input.reference &&
    row.resultRevision === transition.expectedRevision + 1 &&
    row.toState === transition.toState &&
    row.severity === transition.severity &&
    row.privacyClass === transition.privacyClass &&
    row.securityClass === transition.securityClass &&
    row.reproduction === transition.reproduction &&
    row.dedupeDisposition === transition.dedupeDisposition &&
    row.duplicateOfReference === transition.duplicateOfReference &&
    row.ownerQueue === transition.ownerQueue &&
    row.ownerPseudonym === transition.ownerPseudonym &&
    row.customerResponse === transition.customerResponse &&
    row.engineeringIssueRef === transition.engineeringIssueRef &&
    row.operatorPseudonym === input.operatorPseudonym &&
    row.reasonCode === transition.reasonCode &&
    row.supportEvidenceRef === transition.supportEvidenceRef
  )
}

/**
 * Identity-owned, content-free workflow repository. Report bodies and
 * attachment bytes are deliberately absent from every method signature.
 */
export class BetaFeedbackTriageRepository {
  private constructor(private readonly db: Database) {}

  static create(db: Database): BetaFeedbackTriageRepository {
    return new BetaFeedbackTriageRepository(db)
  }

  async prepare(input: PreparedBetaFeedbackTriage): Promise<BetaFeedbackTriageRecord> {
    const rows = await this.db
      .insert(betaFeedbackTriage)
      .values({
        reference: input.reference,
        organizationPseudonym: input.organizationPseudonym,
        actorPseudonym: input.actorPseudonym,
        feedbackType: input.feedbackType,
        impactCode: input.impactCode,
        routeKey: input.routeKey,
        viewport: input.viewport,
        reporterRole: input.reporterRole,
        deliveryState: 'prepared',
        providerReference: null,
        deliveryFailureCode: null,
        attachmentKind: input.attachmentKind,
        attachmentCapturedAt: input.attachmentCapturedAt,
        attachmentExpiresAt: input.attachmentExpiresAt,
        triageState: 'new',
        severity: 'unclassified',
        privacyClass: 'pending',
        securityClass: 'pending',
        reproduction: 'pending',
        dedupeDisposition: 'pending',
        duplicateOfReference: null,
        ownerQueue: 'beta_support',
        ownerPseudonym: null,
        customerResponse: 'pending',
        engineeringIssueRef: null,
        revision: 0,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .returning()
    return record(requireUpdated(rows, 'prepare'))
  }

  async markDelivered(
    input: Readonly<{
      reference: string
      providerReference: string
      expectedRevision: number
      now: Date
    }>,
  ): Promise<BetaFeedbackTriageRecord> {
    const rows = await this.db
      .update(betaFeedbackTriage)
      .set({
        deliveryState: 'delivered',
        providerReference: input.providerReference,
        deliveryFailureCode: null,
        revision: input.expectedRevision + 1,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(betaFeedbackTriage.reference, input.reference),
          eq(betaFeedbackTriage.deliveryState, 'prepared'),
          eq(betaFeedbackTriage.revision, input.expectedRevision),
        ),
      )
      .returning()
    return record(requireUpdated(rows, 'delivery'))
  }

  async markFailed(
    input: Readonly<{
      reference: string
      failureCode: string
      expectedRevision: number
      now: Date
    }>,
  ): Promise<BetaFeedbackTriageRecord> {
    const rows = await this.db
      .update(betaFeedbackTriage)
      .set({
        deliveryState: 'failed',
        providerReference: null,
        deliveryFailureCode: input.failureCode,
        revision: input.expectedRevision + 1,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(betaFeedbackTriage.reference, input.reference),
          eq(betaFeedbackTriage.deliveryState, 'prepared'),
          eq(betaFeedbackTriage.revision, input.expectedRevision),
        ),
      )
      .returning()
    return record(requireUpdated(rows, 'failure'))
  }

  async find(reference: string): Promise<BetaFeedbackTriageRecord | null> {
    const rows = await this.db
      .select()
      .from(betaFeedbackTriage)
      .where(eq(betaFeedbackTriage.reference, reference))
      .limit(1)
    return rows[0] ? record(rows[0]) : null
  }

  /** Content-free internal work queue; pseudonyms and provider IDs stay hidden. */
  async listQueue(limit = 100): Promise<readonly BetaFeedbackTriageQueueItem[]> {
    const boundedLimit = Math.min(200, Math.max(1, Math.trunc(limit)))
    const rows = await this.db
      .select()
      .from(betaFeedbackTriage)
      .where(
        or(
          ne(betaFeedbackTriage.deliveryState, 'delivered'),
          ne(betaFeedbackTriage.triageState, 'resolved'),
        ),
      )
      .orderBy(asc(betaFeedbackTriage.createdAt), asc(betaFeedbackTriage.reference))
      .limit(boundedLimit)
    return rows.map(queueItem)
  }

  async transition(
    input: Readonly<{
      transitionId: string
      reference: string
      operatorPseudonym: string
      transition: BetaFeedbackTriageTransition
      now: Date
    }>,
  ): Promise<BetaFeedbackTriageRecord> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(betaFeedbackTriage)
        .where(eq(betaFeedbackTriage.reference, input.reference))
        .limit(1)
        .for('update')
      const currentRow = rows[0]
      if (!currentRow) throw new Error('Beta feedback triage record was not found')
      const current = record(currentRow)
      const existingTransitions = await tx
        .select()
        .from(betaFeedbackTriageTransitions)
        .where(eq(betaFeedbackTriageTransitions.transitionId, input.transitionId))
        .limit(1)
      const existingTransition = existingTransitions[0]
      if (existingTransition) {
        if (
          isExactTransitionReplay(existingTransition, {
            reference: input.reference,
            operatorPseudonym: input.operatorPseudonym,
            transition: input.transition,
          })
        ) {
          return current
        }
        throw new Error('Beta feedback transition ID belongs to another operation')
      }
      const next = assertBetaFeedbackTriageTransition(current, input.transition)

      if (next.duplicateOfReference) {
        const duplicateRows = await tx
          .select({ reference: betaFeedbackTriage.reference })
          .from(betaFeedbackTriage)
          .where(
            and(
              eq(betaFeedbackTriage.reference, next.duplicateOfReference),
              eq(betaFeedbackTriage.deliveryState, 'delivered'),
            ),
          )
          .limit(1)
        if (!duplicateRows[0]) {
          throw new Error('Duplicate feedback reference is not a delivered report')
        }
      }

      const updated = await tx
        .update(betaFeedbackTriage)
        .set({
          triageState: next.triageState,
          severity: next.severity,
          privacyClass: next.privacyClass,
          securityClass: next.securityClass,
          reproduction: next.reproduction,
          dedupeDisposition: next.dedupeDisposition,
          duplicateOfReference: next.duplicateOfReference,
          ownerQueue: next.ownerQueue,
          ownerPseudonym: next.ownerPseudonym,
          customerResponse: next.customerResponse,
          engineeringIssueRef: next.engineeringIssueRef,
          revision: next.revision,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(betaFeedbackTriage.reference, input.reference),
            eq(betaFeedbackTriage.revision, input.transition.expectedRevision),
          ),
        )
        .returning()
      const updatedRow = requireUpdated(updated, 'transition')
      await tx.insert(betaFeedbackTriageTransitions).values({
        transitionId: input.transitionId,
        feedbackReference: input.reference,
        fromState: current.triageState,
        toState: next.triageState,
        resultRevision: next.revision,
        severity: next.severity,
        privacyClass: next.privacyClass,
        securityClass: next.securityClass,
        reproduction: next.reproduction,
        dedupeDisposition: next.dedupeDisposition,
        duplicateOfReference: next.duplicateOfReference,
        ownerQueue: next.ownerQueue,
        ownerPseudonym: next.ownerPseudonym,
        customerResponse: next.customerResponse,
        engineeringIssueRef: next.engineeringIssueRef,
        operatorPseudonym: input.operatorPseudonym,
        reasonCode: input.transition.reasonCode,
        supportEvidenceRef: input.transition.supportEvidenceRef,
        occurredAt: input.now,
      })
      return record(updatedRow)
    })
  }
}
