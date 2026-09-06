import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  portalLinkCategories,
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
import type {
  PortalWorkflowFactCommand,
  PortalWorkflowFactEvent,
  PortalWorkflowFactResult,
  PortalWorkflowFactStore,
} from '../application/use-cases/complete-content-review'
import { nextLockedPortalRevision } from './portal-command-revision'

const REQUIRED_CONFIGURATION_FIELDS = 5

type PortalWorkflowPortalRow = Readonly<{
  id: string
  organizationId: string
  propertyId: string
  name: string
  description: string | null
  theme: unknown
  publicationState: string
  updatedAt: Date
}>

type PortalWorkflowContentRow = Readonly<{
  categoryCount: number | string
  urls: unknown
}>

type PortalWorkflowSnapshotRow = PortalWorkflowPortalRow & PortalWorkflowContentRow

type PortalWorkflowSnapshot = Readonly<{
  completedFields: number
  requiredFields: number
  approvedDestinations: number
  configuredDestinations: number
  aggregateRevision: Date
}>

function parseTimestamp(value: unknown): Date | null {
  const parsed =
    value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null
}

function parsePortalRow(value: unknown): PortalWorkflowPortalRow | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  if (
    !('id' in value) ||
    typeof value.id !== 'string' ||
    !('organizationId' in value) ||
    typeof value.organizationId !== 'string' ||
    !('propertyId' in value) ||
    typeof value.propertyId !== 'string' ||
    !('name' in value) ||
    typeof value.name !== 'string' ||
    !('description' in value) ||
    (value.description !== null && typeof value.description !== 'string') ||
    !('theme' in value) ||
    !('publicationState' in value) ||
    typeof value.publicationState !== 'string' ||
    !('updatedAt' in value)
  ) {
    return null
  }
  const updatedAt = parseTimestamp(value.updatedAt)
  if (!updatedAt) return null
  return {
    id: value.id,
    organizationId: value.organizationId,
    propertyId: value.propertyId,
    name: value.name,
    description: value.description,
    theme: value.theme,
    publicationState: value.publicationState,
    updatedAt,
  }
}

function parseContentRow(value: unknown): PortalWorkflowContentRow | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !('categoryCount' in value) ||
    (typeof value.categoryCount !== 'number' &&
      typeof value.categoryCount !== 'string') ||
    !('urls' in value)
  ) {
    return null
  }
  return {
    categoryCount: value.categoryCount,
    urls: value.urls,
  }
}

const WORKFLOW_FACT_TYPES = [
  'portal.content_review.completed',
  'portal.configuration_completeness.recorded',
  'portal.approved_destination_ratio.recorded',
] as const satisfies readonly PortalWorkflowFactEvent['_tag'][]

function calculateSnapshot(row: PortalWorkflowSnapshotRow): PortalWorkflowSnapshot {
  if (row.publicationState !== 'published') {
    throw portalError(
      'invalid_publication_transition',
      'content review can only be completed for published Portal content',
    )
  }

  const theme =
    typeof row.theme === 'object' && row.theme !== null && !Array.isArray(row.theme)
      ? row.theme
      : {}
  const primaryColor =
    'primaryColor' in theme && typeof theme.primaryColor === 'string'
      ? theme.primaryColor.trim()
      : ''
  if (!Array.isArray(row.urls)) {
    throw portalError('invalid_url', 'Portal configuration snapshot is malformed')
  }
  const urls = row.urls.filter((url): url is string => typeof url === 'string')
  const categoryCount = Number(row.categoryCount)
  if (
    !Number.isInteger(categoryCount) ||
    categoryCount < 0 ||
    urls.length !== row.urls.length
  ) {
    throw portalError('invalid_url', 'Portal configuration snapshot is malformed')
  }

  const completedFields = [
    row.name.trim().length > 0,
    (row.description?.trim().length ?? 0) > 0,
    primaryColor.length > 0,
    categoryCount > 0,
    urls.length > 0,
  ].filter(Boolean).length

  return {
    completedFields,
    requiredFields: REQUIRED_CONFIGURATION_FIELDS,
    approvedDestinations: urls.filter((url) => validateExternalLink(url).valid).length,
    configuredDestinations: urls.length,
    aggregateRevision: row.updatedAt,
  }
}

async function loadSnapshot(
  tx: Tx,
  command: PortalWorkflowFactCommand,
): Promise<PortalWorkflowSnapshot> {
  // Lock the aggregate in its own statement. Under READ COMMITTED, a single
  // SELECT that both waits on FOR UPDATE and runs child subqueries can retain
  // the statement-start snapshot for those subqueries after PostgreSQL's EPQ
  // recheck. The second statement below starts only after the Portal lock is
  // held, so it observes every child write whose Portal revision we inherited.
  const portalResult = await tx.execute(sql`
    SELECT
      ${portals.id} AS "id",
      ${portals.organizationId} AS "organizationId",
      ${portals.propertyId} AS "propertyId",
      ${portals.name} AS "name",
      ${portals.description} AS "description",
      ${portals.theme} AS "theme",
      ${portals.publicationState} AS "publicationState",
      ${portals.updatedAt} AS "updatedAt"
    FROM ${portals}
    WHERE ${portals.organizationId} = ${command.organizationId}
      AND ${portals.propertyId} = ${command.propertyId}
      AND ${portals.id} = ${command.portalId}
      AND ${portals.deletedAt} IS NULL
    FOR UPDATE
  `)
  const portal = parsePortalRow(portalResult.rows[0])
  if (!portal) {
    throw portalError(
      'portal_not_found',
      'portal not found in the requested tenant scope',
    )
  }

  const contentResult = await tx.execute(sql`
    SELECT
      (
        SELECT COUNT(*)::int
        FROM ${portalLinkCategories}
        WHERE ${portalLinkCategories.organizationId} = ${command.organizationId}
          AND ${portalLinkCategories.portalId} = ${command.portalId}
      ) AS "categoryCount",
      COALESCE(
        (
          SELECT jsonb_agg(${portalLinks.url} ORDER BY ${portalLinks.id})
          FROM ${portalLinks}
          WHERE ${portalLinks.organizationId} = ${command.organizationId}
            AND ${portalLinks.portalId} = ${command.portalId}
        ),
        '[]'::jsonb
      ) AS "urls"
  `)
  const content = parseContentRow(contentResult.rows[0])
  if (!content) {
    throw portalError('invalid_url', 'Portal configuration snapshot is malformed')
  }
  return calculateSnapshot({ ...portal, ...content })
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
      completedFields: snapshot.completedFields,
      requiredFields: snapshot.requiredFields,
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
