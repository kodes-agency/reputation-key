// Metric context — the SQL behind Portal metric evidence.
//
// One statement answers, for every requested Portal and each metric family,
// whether the projection is complete: source facts against consumer receipts
// (are they all applied?), applied facts against the readings and corrections
// they must have produced, and readings that fail the governed-reading
// contract. A single Portal's Results view asks about one Portal; the Portals
// overview asks about all of them in the same statement.
//
// Shape, and why. Each big table (`outbox_events`, `metric_readings`) is
// scanned once per question, filtered to the requested Portals with a plain
// `= ANY(array)` and aggregated by (Portal, family) with a HASH aggregate:
// nothing here needs DISTINCT (an event type belongs to exactly one family and
// a receipt is unique per event and consumer), so nothing forces a sort of every
// reading. The three small aggregates are stacked with UNION ALL and folded by
// one more GROUP BY. There is no join between them and no roster join: a
// planner working from stale statistics turns those into nested loops that go
// quadratic in the Portals asked about, which is how the Fleet projection went
// wrong. Portals and families with nothing to report have no row; the caller
// reads a missing row as zero (`foldEvidenceRows`), a verified "nothing to wait
// for".

import { sql, type SQL } from 'drizzle-orm'
import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'

export type PortalEvidenceScope = Readonly<{
  organizationId: OrganizationId
  /** The Portals asked about, and the Properties they belong to. */
  portalIds: readonly PortalId[]
  propertyIds: readonly PropertyId[]
  startDate: Date
  endDate: Date
}>

const list = (values: readonly string[]) =>
  sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )

/**
 * @param families - VALUES rows of (family, definition_version_id, metric_key,
 *   source_policies, event_types), one per Portal metric family.
 * @param scope - at least one Portal; callers short-circuit an empty roster.
 */
export function portalMetricEvidenceSql(
  families: SQL,
  { organizationId, portalIds, propertyIds, startDate, endDate }: PortalEvidenceScope,
): SQL {
  const portalTexts = sql`ARRAY[${list(portalIds)}]::text[]`
  const portalUuids = sql`ARRAY[${list(portalIds)}]::uuid[]`
  const propertyTexts = sql`ARRAY[${list(propertyIds)}]::text[]`
  const propertyUuids = sql`ARRAY[${list(propertyIds)}]::uuid[]`
  return sql`
    WITH families (
      family, definition_version_id, metric_key, source_policies, event_types
    ) AS (
      VALUES
        ${families}
    ), source_status AS (
      SELECT
        source.payload ->> 'portalId' AS portal_id,
        families.family,
        count(*) AS source_count,
        count(*) FILTER (
          WHERE receipt.status IN ('applied', 'duplicate')
        ) AS applied_count,
        bool_or(coalesce(receipt.status = 'obsolete', false)) AS obsolete_present,
        bool_or(
          coalesce(receipt.status IN ('applied', 'duplicate'), false)
          AND CASE
            WHEN source.event_type LIKE '%.retracted' THEN NOT EXISTS (
              SELECT 1
              FROM metric_corrections AS expected_correction
              JOIN metric_readings AS corrected_reading
                ON corrected_reading.id = expected_correction.reading_id
              WHERE expected_correction.source_event_id =
                      source.id::text || ':' || families.definition_version_id::text
                AND expected_correction.kind = 'retract'
                AND corrected_reading.definition_version_id =
                      families.definition_version_id
                AND corrected_reading.source_event_id =
                      source.payload ->> 'supersedesSourceEventId'
                AND corrected_reading.organization_id = source.organization_id
                AND corrected_reading.portal_id = (source.payload ->> 'portalId')::uuid
            )
            ELSE
              NOT EXISTS (
                SELECT 1
                FROM metric_readings AS expected_reading
                WHERE expected_reading.definition_version_id =
                        families.definition_version_id
                  AND expected_reading.source_event_id = source.id::text
                  AND expected_reading.organization_id = source.organization_id
                  AND expected_reading.portal_id = (source.payload ->> 'portalId')::uuid
              )
              OR (
                source.payload ->> 'supersedesSourceEventId' IS NOT NULL
                AND NOT EXISTS (
                  SELECT 1
                  FROM metric_corrections AS replacement_correction
                  JOIN metric_readings AS superseded_reading
                    ON superseded_reading.id = replacement_correction.reading_id
                  WHERE replacement_correction.source_event_id =
                          source.id::text || ':retract'
                    AND replacement_correction.kind = 'retract'
                    AND superseded_reading.definition_version_id =
                          families.definition_version_id
                    AND superseded_reading.source_event_id =
                          source.payload ->> 'supersedesSourceEventId'
                    AND superseded_reading.organization_id = source.organization_id
                    AND superseded_reading.portal_id = (source.payload ->> 'portalId')::uuid
                )
              )
          END
        ) AS projection_missing,
        0::bigint AS invalid_reading_count,
        max((source.payload ->> 'occurredAt')::timestamptz) AS latest_activity,
        NULL::timestamptz AS correction_head
      FROM outbox_events AS source
      JOIN families
        ON source.event_type = ANY(families.event_types)
      LEFT JOIN event_consumer_receipts AS receipt
        ON receipt.event_id = source.id
       AND receipt.consumer_name = 'metric.guest-analytics'
      WHERE source.organization_id = ${organizationId}
        AND source.source_context = 'guest'
        AND source.property_id = ANY(${propertyTexts})
        AND source.payload ->> 'portalId' = ANY(${portalTexts})
        AND (source.payload ->> 'occurredAt')::timestamptz >= ${startDate}
        AND (source.payload ->> 'occurredAt')::timestamptz < ${endDate}
      GROUP BY source.payload ->> 'portalId', families.family
    ), reading_status AS (
      SELECT
        reading.portal_id::text AS portal_id,
        families.family,
        0::bigint AS source_count,
        0::bigint AS applied_count,
        false AS obsolete_present,
        false AS projection_missing,
        count(*) FILTER (
          WHERE (
            reading.definition_version_id = families.definition_version_id
            AND reading.metric_key = families.metric_key
            AND reading.exact_value IS NOT NULL
            AND reading.data_quality = 'exact'
            AND reading.attribution_quality <> 'unresolved'
            AND reading.source_policy = ANY(families.source_policies)
            AND (
              families.family <> 'privateRatings'
              OR (
                reading.exact_value BETWEEN 1 AND 5
                AND reading.exact_value = trunc(reading.exact_value)
              )
            )
          ) IS NOT TRUE
        ) AS invalid_reading_count,
        NULL::timestamptz AS latest_activity,
        NULL::timestamptz AS correction_head
      FROM metric_readings AS reading
      JOIN families
        ON reading.metric_key = families.metric_key
      WHERE reading.organization_id = ${organizationId}
        AND reading.property_id = ANY(${propertyUuids})
        AND reading.portal_id = ANY(${portalUuids})
        AND reading.event_at >= ${startDate}
        AND reading.event_at < ${endDate}
      GROUP BY reading.portal_id, families.family
    ), correction_status AS (
      SELECT
        reading.portal_id::text AS portal_id,
        families.family,
        0::bigint AS source_count,
        0::bigint AS applied_count,
        false AS obsolete_present,
        false AS projection_missing,
        0::bigint AS invalid_reading_count,
        NULL::timestamptz AS latest_activity,
        max(correction.recorded_at) AS correction_head
      FROM metric_readings AS reading
      JOIN families
        ON reading.metric_key = families.metric_key
      JOIN metric_corrections AS correction
        ON correction.reading_id = reading.id
      WHERE reading.organization_id = ${organizationId}
        AND reading.property_id = ANY(${propertyUuids})
        AND reading.portal_id = ANY(${portalUuids})
        AND reading.event_at >= ${startDate}
        AND reading.event_at < ${endDate}
      GROUP BY reading.portal_id, families.family
    )
    SELECT
      combined.portal_id,
      combined.family,
      families.definition_version_id,
      sum(combined.source_count) AS source_count,
      sum(combined.applied_count) AS applied_count,
      bool_or(combined.obsolete_present) AS obsolete_present,
      bool_or(combined.projection_missing) AS projection_missing,
      sum(combined.invalid_reading_count) AS invalid_reading_count,
      max(combined.latest_activity) AS latest_activity,
      max(combined.correction_head) AS correction_head
    FROM (
      SELECT * FROM source_status
      UNION ALL
      SELECT * FROM reading_status
      UNION ALL
      SELECT * FROM correction_status
    ) AS combined
    JOIN families
      ON families.family = combined.family
    GROUP BY combined.portal_id, combined.family, families.definition_version_id
  `
}
