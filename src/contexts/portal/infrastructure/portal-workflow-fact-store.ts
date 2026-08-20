import { createHash } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import {
  portalLinkCategories,
  portalLinks,
  portals,
} from '#/shared/db/schema/portal.schema'
import type { EventBus } from '#/shared/events/event-bus'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import { emitAfterCommit, type Tx } from '#/shared/outbox/commit'
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

const REQUIRED_CONFIGURATION_FIELDS = 5

type PortalWorkflowSnapshotRow = Readonly<{
  id: string
  organizationId: string
  propertyId: string
  name: string
  description: string | null
  theme: unknown
  publicationState: string
  categoryCount: number | string
  urls: unknown
}>

type PortalWorkflowSnapshot = Readonly<{
  completedFields: number
  requiredFields: number
  approvedDestinations: number
  configuredDestinations: number
}>

function parseSnapshotRow(value: unknown): PortalWorkflowSnapshotRow | null {
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
    !('categoryCount' in value) ||
    (typeof value.categoryCount !== 'number' &&
      typeof value.categoryCount !== 'string') ||
    !('urls' in value)
  ) {
    return null
  }
  return {
    id: value.id,
    organizationId: value.organizationId,
    propertyId: value.propertyId,
    name: value.name,
    description: value.description,
    theme: value.theme,
    publicationState: value.publicationState,
    categoryCount: value.categoryCount,
    urls: value.urls,
  }
}

function deterministicEventId(
  command: PortalWorkflowFactCommand,
  eventType: PortalWorkflowFactEvent['_tag'],
): string {
  const hex = createHash('sha256')
    .update(
      [
        command.organizationId,
        command.propertyId,
        command.portalId,
        command.reviewId,
        String(command.revision),
        eventType,
      ].join(':'),
    )
    .digest('hex')
  const variant = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

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
  }
}

async function loadSnapshot(
  tx: Tx,
  command: PortalWorkflowFactCommand,
): Promise<PortalWorkflowSnapshot> {
  const result = await tx.execute(sql`
    WITH locked_portal AS (
      SELECT
        ${portals.id} AS "id",
        ${portals.organizationId} AS "organizationId",
        ${portals.propertyId} AS "propertyId",
        ${portals.name} AS "name",
        ${portals.description} AS "description",
        ${portals.theme} AS "theme",
        ${portals.publicationState} AS "publicationState"
      FROM ${portals}
      WHERE ${portals.organizationId} = ${command.organizationId}
        AND ${portals.propertyId} = ${command.propertyId}
        AND ${portals.id} = ${command.portalId}
        AND ${portals.deletedAt} IS NULL
      FOR UPDATE
    )
    SELECT
      locked_portal.*,
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
    FROM locked_portal
  `)
  const row = parseSnapshotRow(result.rows[0])
  if (!row) {
    throw portalError(
      'portal_not_found',
      'portal not found in the requested tenant scope',
    )
  }
  return calculateSnapshot(row)
}

function buildEvents(
  command: PortalWorkflowFactCommand,
  snapshot: PortalWorkflowSnapshot,
): readonly PortalWorkflowFactEvent[] {
  const common = {
    reviewId: command.reviewId,
    revision: command.revision,
    organizationId: command.organizationId,
    propertyId: command.propertyId,
    portalId: command.portalId,
    portalGroupId: command.portalGroupId,
    occurredAt: command.occurredAt,
  }
  return [
    portalContentReviewCompleted({
      ...common,
      eventId: deterministicEventId(command, 'portal.content_review.completed'),
      supersedesSourceEventId: command.supersedes?.contentReviewSourceEventId ?? null,
    }),
    portalConfigurationCompletenessRecorded({
      ...common,
      eventId: deterministicEventId(
        command,
        'portal.configuration_completeness.recorded',
      ),
      supersedesSourceEventId: command.supersedes?.configurationSourceEventId ?? null,
      completedFields: snapshot.completedFields,
      requiredFields: snapshot.requiredFields,
    }),
    portalApprovedDestinationRatioRecorded({
      ...common,
      eventId: deterministicEventId(
        command,
        'portal.approved_destination_ratio.recorded',
      ),
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
    const rows = await tx
      .insert(outboxEvents)
      .values({ ...toOutboxEvent(event), id: event.eventId })
      .onConflictDoNothing()
      .returning({ id: outboxEvents.id })
    inserted += rows.length
  }
  return inserted
}

export function createPortalWorkflowFactStore(
  db: Database,
  events: EventBus,
): PortalWorkflowFactStore {
  return {
    recordCompletedReview: async (
      command: PortalWorkflowFactCommand,
    ): Promise<PortalWorkflowFactResult> => {
      const result = await db.transaction(async (tx) => {
        const snapshot = await loadSnapshot(tx, command)
        const facts = buildEvents(command, snapshot)
        const inserted = await insertFacts(tx, facts)
        if (inserted !== 0 && inserted !== facts.length) {
          throw new Error('partial Portal workflow fact set detected')
        }
        if (inserted === 0) {
          return { status: 'duplicate' as const, events: facts }
        }
        await tx
          .update(portals)
          .set({ updatedAt: command.occurredAt })
          .where(
            and(
              eq(portals.organizationId, command.organizationId),
              eq(portals.propertyId, command.propertyId),
              eq(portals.id, command.portalId),
            ),
          )
        return { status: 'recorded' as const, events: facts }
      })

      if (result.status === 'recorded') {
        for (const event of result.events) {
          await emitAfterCommit(events, event)
        }
      }
      return result
    },
  }
}
