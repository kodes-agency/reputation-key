// Metric context — the SQL behind Portal metric evidence.
//
// One statement answers, per metric family, whether the projection is complete:
// source facts against consumer receipts (are they all applied?), applied facts
// against the readings and corrections they must have produced, and readings
// that fail the governed-reading contract. Extracted so the repository stays
// readable; the caller supplies the `families` VALUES rows because they are
// built from the pinned metric definitions it owns.

import { sql, type SQL } from 'drizzle-orm'
import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'

export type PortalEvidenceScope = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  startDate: Date
  endDate: Date
}>

/**
 * @param families - VALUES rows of (family, definition_version_id, metric_key,
 *   source_policies, event_types), one per Portal metric family.
 */
export function portalMetricEvidenceSql(
  families: SQL,
  { organizationId, propertyId, portalId, startDate, endDate }: PortalEvidenceScope,
): SQL {
  return sql`
    WITH families (
      family, definition_version_id, metric_key, source_policies, event_types
    ) AS (
      VALUES
        ${families}
          ), source_status AS (
            SELECT
              families.family,
              count(DISTINCT source.id) AS source_count,
              count(DISTINCT source.id) FILTER (
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
                      AND corrected_reading.organization_id = ${organizationId}
                      AND corrected_reading.property_id = ${propertyId}
                      AND corrected_reading.portal_id = ${portalId}
                  )
                  ELSE
                    NOT EXISTS (
                      SELECT 1
                      FROM metric_readings AS expected_reading
                      WHERE expected_reading.definition_version_id =
                              families.definition_version_id
                        AND expected_reading.source_event_id = source.id::text
                        AND expected_reading.organization_id = ${organizationId}
                        AND expected_reading.property_id = ${propertyId}
                        AND expected_reading.portal_id = ${portalId}
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
                          AND superseded_reading.organization_id = ${organizationId}
                          AND superseded_reading.property_id = ${propertyId}
                          AND superseded_reading.portal_id = ${portalId}
                      )
                    )
                END
              ) AS projection_missing,
              max((source.payload ->> 'occurredAt')::timestamptz) AS latest_activity
            FROM families
            LEFT JOIN outbox_events AS source
              ON source.organization_id = ${organizationId}
             AND source.property_id = ${propertyId}
             AND source.source_context = 'guest'
             AND source.event_type = ANY(families.event_types)
             AND source.payload ->> 'portalId' = ${portalId}
             AND (source.payload ->> 'occurredAt')::timestamptz >= ${startDate}
             AND (source.payload ->> 'occurredAt')::timestamptz < ${endDate}
            LEFT JOIN event_consumer_receipts AS receipt
              ON receipt.event_id = source.id
             AND receipt.consumer_name = 'metric.guest-analytics'
            GROUP BY families.family
          ), reading_status AS (
            SELECT
              families.family,
              count(DISTINCT reading.id) FILTER (
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
              max(correction.recorded_at) AS correction_head
            FROM families
            LEFT JOIN metric_readings AS reading
              ON reading.organization_id = ${organizationId}
             AND reading.property_id = ${propertyId}
             AND reading.portal_id = ${portalId}
             AND reading.metric_key = families.metric_key
             AND reading.event_at >= ${startDate}
             AND reading.event_at < ${endDate}
            LEFT JOIN metric_corrections AS correction
              ON correction.reading_id = reading.id
            GROUP BY families.family
          )
          SELECT
            families.family,
            families.definition_version_id,
            source_status.source_count,
            source_status.applied_count,
            source_status.obsolete_present,
            source_status.projection_missing,
            reading_status.invalid_reading_count,
            source_status.latest_activity,
            reading_status.correction_head
          FROM families
          JOIN source_status USING (family)
          JOIN reading_status USING (family)
  `
}
