import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { PortalGroupPublicApi } from '#/contexts/portal/application/public-api'
import { portalId } from '#/shared/domain/ids'
import type {
  GoalMetricSourceStatus,
  GoalMetricSourceStatusPort,
} from '../../application/ports/goal-metric-source-status.port'

type SourceRow = Readonly<{
  event_id: unknown
  event_type: unknown
  payload: unknown
  receipt_status: unknown
  quarantined: unknown
  reading_portal_id: unknown
  reading_group_id: unknown
  correction_present: unknown
  replacement_correction_present: unknown
}>

type ParsedSourceRow = Readonly<{
  eventId: string
  eventType: string
  portalId: string
  capturedPortalGroupId: string | null
  hasCapturedPortalGroup: boolean
  occurredAt: Date
  receiptStatus: string | null
  quarantined: boolean
  readingPortalId: string | null
  readingGroupId: string | null
  correctionPresent: boolean
  supersedesSourceEventId: string | null
  replacementCorrectionPresent: boolean
}>

const result = (
  state: GoalMetricSourceStatus['state'],
  relevantFactCount: number,
  pendingFactCount: number,
  reason: string | null,
): GoalMetricSourceStatus => ({
  state,
  relevantFactCount,
  pendingFactCount,
  reason,
})

function parseRow(row: SourceRow): ParsedSourceRow | null {
  const payload = row.payload
  if (
    typeof row.event_id !== 'string' ||
    typeof row.event_type !== 'string' ||
    typeof payload !== 'object' ||
    payload === null
  ) {
    return null
  }
  const portal = (payload as Record<string, unknown>)['portalId']
  const occurred = (payload as Record<string, unknown>)['occurredAt']
  const supersedes = (payload as Record<string, unknown>)['supersedesSourceEventId']
  const payloadRecord = payload as Record<string, unknown>
  const capturedGroup = payloadRecord['portalGroupId']
  if (typeof portal !== 'string' || typeof occurred !== 'string') return null
  const occurredAt = new Date(occurred)
  if (Number.isNaN(occurredAt.getTime())) return null
  return {
    eventId: row.event_id,
    eventType: row.event_type,
    portalId: portal,
    capturedPortalGroupId: typeof capturedGroup === 'string' ? capturedGroup : null,
    hasCapturedPortalGroup: Object.hasOwn(payloadRecord, 'portalGroupId'),
    occurredAt,
    receiptStatus: typeof row.receipt_status === 'string' ? row.receipt_status : null,
    quarantined: row.quarantined === true,
    readingPortalId:
      typeof row.reading_portal_id === 'string' ? row.reading_portal_id : null,
    readingGroupId:
      typeof row.reading_group_id === 'string' ? row.reading_group_id : null,
    correctionPresent: row.correction_present === true,
    supersedesSourceEventId: typeof supersedes === 'string' ? supersedes : null,
    replacementCorrectionPresent: row.replacement_correction_present === true,
  }
}

export const createGoalMetricSourceStatus = (
  db: Database,
  portalGroups: PortalGroupPublicApi,
): GoalMetricSourceStatusPort => {
  return {
    inspect: async (query, eventTypes) => {
      if (eventTypes.length === 0) return result('unavailable', 0, 0, 'no_source')
      const eventTypeSql = sql.join(
        eventTypes.map((eventType) => sql`${eventType}`),
        sql`, `,
      )
      const raw = await db.execute(sql`
        SELECT
          source.id::text AS event_id,
          source.event_type,
          source.payload,
          receipt.status AS receipt_status,
          EXISTS (
            SELECT 1
            FROM metric_quarantine AS quarantine
            WHERE quarantine.source_event_id = source.id::text
              AND quarantine.definition_version_id = ${query.definitionVersionId}::uuid
              AND quarantine.resolved_at IS NULL
          ) AS quarantined,
          (
            SELECT reading.portal_id::text
            FROM metric_readings AS reading
            WHERE reading.definition_version_id = ${query.definitionVersionId}::uuid
              AND reading.source_event_id = source.id::text
            LIMIT 1
          ) AS reading_portal_id,
          (
            SELECT reading.group_id::text
            FROM metric_readings AS reading
            WHERE reading.definition_version_id = ${query.definitionVersionId}::uuid
              AND reading.source_event_id = source.id::text
            LIMIT 1
          ) AS reading_group_id,
          EXISTS (
            SELECT 1
            FROM metric_corrections AS correction
            JOIN metric_readings AS corrected_reading
              ON corrected_reading.id = correction.reading_id
            WHERE correction.source_event_id = source.id::text || ':' || ${query.definitionVersionId}
              AND correction.kind = 'retract'
              AND corrected_reading.definition_version_id = ${query.definitionVersionId}::uuid
              AND corrected_reading.source_event_id = source.payload ->> 'supersedesSourceEventId'
              AND corrected_reading.portal_id::text = source.payload ->> 'portalId'
          ) AS correction_present,
          EXISTS (
            SELECT 1
            FROM metric_corrections AS correction
            JOIN metric_readings AS corrected_reading
              ON corrected_reading.id = correction.reading_id
            WHERE correction.source_event_id = source.id::text || ':retract'
              AND correction.kind = 'retract'
              AND corrected_reading.definition_version_id = ${query.definitionVersionId}::uuid
              AND corrected_reading.source_event_id = source.payload ->> 'supersedesSourceEventId'
              AND corrected_reading.portal_id::text = source.payload ->> 'portalId'
          ) AS replacement_correction_present
        FROM outbox_events AS source
        LEFT JOIN event_consumer_receipts AS receipt
          ON receipt.event_id = source.id
         AND receipt.consumer_name = 'metric.guest-analytics'
        WHERE source.organization_id = ${query.organizationId}
          AND source.property_id = ${query.propertyId}
          AND source.source_context = 'guest'
          AND source.event_type IN (${eventTypeSql})
          AND (source.payload ->> 'occurredAt')::timestamptz >= ${query.periodStart}
          AND (source.payload ->> 'occurredAt')::timestamptz < ${query.periodEnd}
        ORDER BY source.created_at, source.id
      `)

      const parsed: ParsedSourceRow[] = []
      for (const rawRow of raw.rows as SourceRow[]) {
        const row = parseRow(rawRow)
        if (!row)
          return result('quarantined', parsed.length + 1, 0, 'invalid_source_fact')
        parsed.push(row)
      }

      const relevant: Array<ParsedSourceRow & { expectedGroupId: string | null }> = []
      for (const row of parsed) {
        if (query.subject.kind === 'portal' && row.portalId !== query.subject.portalId) {
          continue
        }
        if (query.subject.kind === 'portal_group') {
          if (row.hasCapturedPortalGroup) {
            if (row.capturedPortalGroupId !== query.subject.portalGroupId) continue
            relevant.push({ ...row, expectedGroupId: row.capturedPortalGroupId })
            continue
          }
          let group
          try {
            group = await portalGroups.findGroupForPortal(
              query.organizationId,
              portalId(row.portalId),
              row.occurredAt,
            )
          } catch {
            return result(
              'unavailable',
              relevant.length + 1,
              0,
              'source_attribution_unavailable',
            )
          }
          if (!group || group.id !== query.subject.portalGroupId) continue
          relevant.push({ ...row, expectedGroupId: group.id })
          continue
        }
        relevant.push({ ...row, expectedGroupId: null })
      }

      let pending = 0
      for (const row of relevant) {
        if (row.receiptStatus === 'obsolete') {
          return result('unavailable', relevant.length, pending, 'source_fact_obsolete')
        }
        if (row.receiptStatus !== 'applied' && row.receiptStatus !== 'duplicate') {
          pending += 1
          continue
        }
        if (row.quarantined) {
          return result(
            'quarantined',
            relevant.length,
            pending,
            'source_fact_quarantined',
          )
        }
        const isRetraction = row.eventType.endsWith('.retracted')
        if (isRetraction && !row.correctionPresent) {
          return result('quarantined', relevant.length, pending, 'projection_missing')
        }
        if (!isRetraction) {
          if (row.readingPortalId !== row.portalId) {
            return result(
              'quarantined',
              relevant.length,
              pending,
              'portal_attribution_mismatch',
            )
          }
          if (
            query.subject.kind === 'portal_group' &&
            row.readingGroupId !== row.expectedGroupId
          ) {
            return result(
              'quarantined',
              relevant.length,
              pending,
              'group_attribution_mismatch',
            )
          }
          if (row.supersedesSourceEventId && !row.replacementCorrectionPresent) {
            return result('quarantined', relevant.length, pending, 'correction_missing')
          }
        }
      }

      return pending > 0
        ? result('pending', relevant.length, pending, 'consumer_receipt_pending')
        : result('complete', relevant.length, 0, null)
    },
  }
}
