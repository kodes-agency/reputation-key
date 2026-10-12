import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  portalApprovedDestinations,
  portalLinks,
  portals,
} from '#/shared/db/schema/portal.schema'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import { insertOutboxRowIfNew, type Tx } from '#/shared/outbox/commit'
import {
  portalApprovedDestinationRatioRecorded,
  portalConfigurationCompletenessRecorded,
  portalContentReviewCompleted,
} from '../domain/events'
import { portalError } from '../domain/errors'
import { validateExternalLink } from '../domain/safe-link'
import {
  evaluatePortalConfigurationCompleteness,
  type PortalConfigurationCompleteness,
} from '../domain/portal-configuration-completeness'
import type {
  PortalWorkflowFactCommand,
  PortalWorkflowFactEvent,
  PortalWorkflowFactResult,
  PortalWorkflowFactStore,
} from '../application/use-cases/complete-content-review'
import { nextLockedPortalRevision } from './portal-command-revision'
import { readPortalWorkingCopy } from './portal-working-copy.reader'

type PortalWorkflowSnapshot = Readonly<{
  completeness: PortalConfigurationCompleteness
  approvedDestinations: number
  configuredDestinations: number
}>

/** One link: its raw address (a link from before Property destinations) or its destination's approval. */
type LinkDestinationRow = Readonly<{
  url: string | null
  destinationId: string | null
  approvalState: string | null
}>

function parsePublicationState(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  return 'publicationState' in value && typeof value.publicationState === 'string'
    ? value.publicationState
    : null
}

const WORKFLOW_FACT_TYPES = [
  'portal.content_review.completed',
  'portal.configuration_completeness.recorded',
  'portal.approved_destination_ratio.recorded',
] as const satisfies readonly PortalWorkflowFactEvent['_tag'][]

/**
 * A link's destination counts as approved when its Property destination is
 * approved; a raw address from before Property destinations keeps the rule it
 * was always counted by, the safe-link allowlist (ADR 0044).
 */
function isApprovedDestination(link: LinkDestinationRow): boolean {
  if (link.destinationId !== null) return link.approvalState === 'approved'
  return link.url !== null && validateExternalLink(link.url).valid
}

async function readLinkDestinations(
  tx: Tx,
  command: PortalWorkflowFactCommand,
): Promise<readonly LinkDestinationRow[]> {
  return tx
    .select({
      url: portalLinks.url,
      destinationId: portalLinks.destinationId,
      approvalState: portalApprovedDestinations.approvalState,
    })
    .from(portalLinks)
    .leftJoin(
      portalApprovedDestinations,
      and(
        eq(portalApprovedDestinations.organizationId, portalLinks.organizationId),
        eq(portalApprovedDestinations.propertyId, portalLinks.propertyId),
        eq(portalApprovedDestinations.id, portalLinks.destinationId),
      ),
    )
    .where(
      and(
        eq(portalLinks.organizationId, command.organizationId),
        eq(portalLinks.portalId, command.portalId),
      ),
    )
}

async function loadSnapshot(
  tx: Tx,
  command: PortalWorkflowFactCommand,
): Promise<PortalWorkflowSnapshot> {
  // Lock the aggregate in its own statement. Under READ COMMITTED, a single
  // SELECT that both waits on FOR UPDATE and runs child subqueries can retain
  // the statement-start snapshot for those subqueries after PostgreSQL's EPQ
  // recheck. The reads below start only after the Portal lock is held, so they
  // observe every Portal child write whose revision we inherited. The
  // Property-wide rows (look, wording, time zone) are not under this lock: a
  // Property edit committed meanwhile is counted now or by the next review.
  // Fencing them would mean the Property publication lock, taken before this
  // row (ADR 0060).
  const locked = await tx.execute(sql`
    SELECT ${portals.publicationState} AS "publicationState"
    FROM ${portals}
    WHERE ${portals.organizationId} = ${command.organizationId}
      AND ${portals.propertyId} = ${command.propertyId}
      AND ${portals.id} = ${command.portalId}
      AND ${portals.deletedAt} IS NULL
    FOR UPDATE
  `)
  const publicationState = parsePublicationState(locked.rows[0])
  if (publicationState === null) {
    throw portalError(
      'portal_not_found',
      'portal not found in the requested tenant scope',
    )
  }
  if (publicationState !== 'published') {
    throw portalError(
      'invalid_publication_transition',
      'content review can only be completed for published Portal content',
    )
  }

  // Completeness is counted on what Publish reads, through the same reader.
  const source = await readPortalWorkingCopy(tx, {
    organizationId: command.organizationId,
    propertyId: command.propertyId,
    portalId: command.portalId,
  })
  if (!source) {
    throw portalError(
      'publication_snapshot_unavailable',
      'Portal working copy is unavailable',
    )
  }
  const links = await readLinkDestinations(tx, command)
  return {
    completeness: evaluatePortalConfigurationCompleteness({
      source,
      googleReviewDestinationVerified: command.googleReviewDestinationVerified,
    }),
    approvedDestinations: links.filter(isApprovedDestination).length,
    configuredDestinations: links.length,
  }
}

function buildEvents(
  command: PortalWorkflowFactCommand,
  snapshot: PortalWorkflowSnapshot,
  aggregateRevision: Date,
): readonly PortalWorkflowFactEvent[] {
  const common = {
    reviewId: command.reviewId,
    revision: command.revision,
    organizationId: command.organizationId,
    propertyId: command.propertyId,
    portalId: command.portalId,
    portalGroupId: command.portalGroupId,
    sourceAggregateVersion: aggregateRevision.toISOString(),
    occurredAt: command.occurredAt,
  }
  return [
    portalContentReviewCompleted({
      ...common,
      supersedesSourceEventId: command.supersedes?.contentReviewSourceEventId ?? null,
    }),
    portalConfigurationCompletenessRecorded({
      ...common,
      supersedesSourceEventId: command.supersedes?.configurationSourceEventId ?? null,
      completedFields: snapshot.completeness.completedFields,
      requiredFields: snapshot.completeness.requiredFields,
      fieldSet: snapshot.completeness.fieldSet,
    }),
    portalApprovedDestinationRatioRecorded({
      ...common,
      supersedesSourceEventId: command.supersedes?.destinationRatioSourceEventId ?? null,
      approvedDestinations: snapshot.approvedDestinations,
      configuredDestinations: snapshot.configuredDestinations,
    }),
  ]
}

async function insertFacts(
  tx: Tx,
  events: readonly PortalWorkflowFactEvent[],
): Promise<number> {
  let inserted = 0
  for (const event of events) {
    if (await insertOutboxRowIfNew(tx, event)) inserted += 1
  }
  return inserted
}

export const createPortalWorkflowFactStore = (db: Database): PortalWorkflowFactStore => {
  return {
    recordCompletedReview: async (
      command: PortalWorkflowFactCommand,
    ): Promise<PortalWorkflowFactResult> => {
      const result = await db.transaction(async (tx) => {
        const snapshot = await loadSnapshot(tx, command)
        const existingFacts = await tx
          .select({ eventType: outboxEvents.eventType })
          .from(outboxEvents)
          .where(
            and(
              eq(outboxEvents.organizationId, command.organizationId),
              eq(outboxEvents.propertyId, command.propertyId),
              eq(outboxEvents.sourceContext, 'portal'),
              eq(outboxEvents.sourceAggregateId, command.reviewId),
              inArray(outboxEvents.eventType, WORKFLOW_FACT_TYPES),
              sql`${outboxEvents.payload}->>'portalId' = ${command.portalId}`,
              sql`${outboxEvents.payload}->>'revision' = ${String(command.revision)}`,
            ),
          )
        const existingTypes = new Set(existingFacts.map(({ eventType }) => eventType))
        if (
          existingFacts.length === WORKFLOW_FACT_TYPES.length &&
          WORKFLOW_FACT_TYPES.every((eventType) => existingTypes.has(eventType))
        ) {
          return { status: 'duplicate' as const, events: [] }
        }
        if (existingFacts.length !== 0) {
          throw new Error('partial Portal workflow fact set detected')
        }
        const [updated] = await tx
          .update(portals)
          .set({ updatedAt: nextLockedPortalRevision(command.occurredAt) })
          .where(
            and(
              eq(portals.organizationId, command.organizationId),
              eq(portals.propertyId, command.propertyId),
              eq(portals.id, command.portalId),
            ),
          )
          .returning({ updatedAt: portals.updatedAt })
        if (!updated) {
          throw portalError(
            'revision_conflict',
            'Portal changed while workflow facts were being committed',
          )
        }
        const facts = buildEvents(command, snapshot, updated.updatedAt)
        const inserted = await insertFacts(tx, facts)
        if (inserted !== facts.length) {
          throw new Error('partial Portal workflow fact set detected')
        }
        return { status: 'recorded' as const, events: facts }
      })

      return result
    },
  }
}
