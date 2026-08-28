import { sql } from 'drizzle-orm'

/**
 * Read-only evidence for immutable Primary Staff snapshots. A retained
 * responsibility may be ended after an observation, so exact snapshots never
 * compare their captured effective_to with today's responsibility row.
 */
export const attributionPeopleAuthorityRowsSql = () => sql`
  SELECT
    'guest_qualified_scan'::text AS "source",
    scan.id::text AS "sourceId",
    'event_time_staff_attribution'::text AS "dimension",
    CASE
      WHEN scan.attributed_staff_participant_id IS NULL
        AND COALESCE(active_primary.candidate_count, 0) = 0 THEN 'exact'
      WHEN scan.attributed_staff_participant_id IS NULL THEN 'unsafe'
      WHEN responsibility.id IS NULL OR participation.id IS NULL THEN 'orphan'
      WHEN responsibility.organization_id <> scan.organization_id
        OR responsibility.property_id <> scan.property_id
        OR responsibility.portal_id <> scan.portal_id
        OR responsibility.staff_participation_id <> scan.attributed_staff_participation_id
        OR participation.staff_participant_id <> scan.attributed_staff_participant_id
        OR scan.staff_attribution_effective_from > scan.occurred_at
        OR (scan.staff_attribution_effective_to IS NOT NULL
          AND scan.staff_attribution_effective_to <= scan.occurred_at) THEN 'conflict'
      ELSE 'exact'
    END::text AS "outcome",
    scan.organization_id::text AS "organizationId",
    scan.property_id::text AS "propertyId",
    scan.portal_id::text AS "portalId",
    NULL::text AS "userId",
    CASE
      WHEN scan.attributed_staff_participant_id IS NULL
        AND COALESCE(active_primary.candidate_count, 0) = 0
        THEN 'guest_scan_had_no_primary_at_observation'
      WHEN scan.attributed_staff_participant_id IS NULL
        THEN 'guest_scan_missing_event_time_primary'
      WHEN responsibility.id IS NULL THEN 'guest_scan_responsibility_missing'
      WHEN participation.id IS NULL THEN 'guest_scan_participation_missing'
      WHEN responsibility.organization_id <> scan.organization_id
        OR responsibility.property_id <> scan.property_id
        OR responsibility.portal_id <> scan.portal_id
        OR responsibility.staff_participation_id <> scan.attributed_staff_participation_id
        OR participation.staff_participant_id <> scan.attributed_staff_participant_id
        OR scan.staff_attribution_effective_from > scan.occurred_at
        OR (scan.staff_attribution_effective_to IS NOT NULL
          AND scan.staff_attribution_effective_to <= scan.occurred_at)
        THEN 'guest_scan_attribution_scope_or_interval_conflict'
      ELSE 'guest_scan_event_time_primary_exact'
    END::text AS "reasonCode",
    array_remove(ARRAY[
      scan.attributed_staff_participant_id::text,
      scan.attributed_staff_participation_id::text,
      scan.attribution_responsibility_id::text
    ], NULL) AS "relatedIds"
  FROM guest_qualified_scans scan
  LEFT JOIN portal_responsibilities responsibility
    ON responsibility.id = scan.attribution_responsibility_id
  LEFT JOIN staff_participations participation
    ON participation.id = scan.attributed_staff_participation_id
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS candidate_count
    FROM portal_responsibilities candidate
    WHERE candidate.organization_id = scan.organization_id
      AND candidate.property_id = scan.property_id
      AND candidate.portal_id = scan.portal_id
      AND candidate.kind = 'primary'
      AND candidate.effective_from <= scan.occurred_at
      AND (candidate.effective_to IS NULL OR candidate.effective_to > scan.occurred_at)
  ) active_primary ON TRUE

  UNION ALL

  SELECT
    'guest_response'::text AS "source",
    response.id::text AS "sourceId",
    'event_time_staff_attribution'::text AS "dimension",
    CASE
      WHEN response.attributed_staff_participant_id IS NULL
        AND COALESCE(active_primary.candidate_count, 0) = 0 THEN 'exact'
      WHEN response.attributed_staff_participant_id IS NULL THEN 'unsafe'
      WHEN responsibility.id IS NULL OR participation.id IS NULL THEN 'orphan'
      WHEN response.submitted_at IS NULL
        OR responsibility.organization_id <> response.organization_id
        OR responsibility.property_id <> response.property_id
        OR responsibility.portal_id <> response.portal_id
        OR responsibility.staff_participation_id <> response.attributed_staff_participation_id
        OR participation.staff_participant_id <> response.attributed_staff_participant_id
        OR response.staff_attribution_effective_from > response.submitted_at
        OR (response.staff_attribution_effective_to IS NOT NULL
          AND response.staff_attribution_effective_to <= response.submitted_at) THEN 'conflict'
      ELSE 'exact'
    END::text AS "outcome",
    response.organization_id::text AS "organizationId",
    response.property_id::text AS "propertyId",
    response.portal_id::text AS "portalId",
    NULL::text AS "userId",
    CASE
      WHEN response.attributed_staff_participant_id IS NULL
        AND COALESCE(active_primary.candidate_count, 0) = 0
        THEN 'guest_response_had_no_primary_at_observation'
      WHEN response.attributed_staff_participant_id IS NULL
        THEN 'guest_response_missing_event_time_primary'
      WHEN responsibility.id IS NULL THEN 'guest_response_responsibility_missing'
      WHEN participation.id IS NULL THEN 'guest_response_participation_missing'
      WHEN response.submitted_at IS NULL
        OR responsibility.organization_id <> response.organization_id
        OR responsibility.property_id <> response.property_id
        OR responsibility.portal_id <> response.portal_id
        OR responsibility.staff_participation_id <> response.attributed_staff_participation_id
        OR participation.staff_participant_id <> response.attributed_staff_participant_id
        OR response.staff_attribution_effective_from > response.submitted_at
        OR (response.staff_attribution_effective_to IS NOT NULL
          AND response.staff_attribution_effective_to <= response.submitted_at)
        THEN 'guest_response_attribution_scope_or_interval_conflict'
      ELSE 'guest_response_event_time_primary_exact'
    END::text AS "reasonCode",
    array_remove(ARRAY[
      response.attributed_staff_participant_id::text,
      response.attributed_staff_participation_id::text,
      response.attribution_responsibility_id::text
    ], NULL) AS "relatedIds"
  FROM guest_responses response
  LEFT JOIN portal_responsibilities responsibility
    ON responsibility.id = response.attribution_responsibility_id
  LEFT JOIN staff_participations participation
    ON participation.id = response.attributed_staff_participation_id
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS candidate_count
    FROM portal_responsibilities candidate
    WHERE candidate.organization_id = response.organization_id
      AND candidate.property_id = response.property_id
      AND candidate.portal_id = response.portal_id
      AND candidate.kind = 'primary'
      AND response.submitted_at IS NOT NULL
      AND candidate.effective_from <= response.submitted_at
      AND (candidate.effective_to IS NULL OR candidate.effective_to > response.submitted_at)
  ) active_primary ON TRUE

  UNION ALL

  SELECT
    'metric_reading'::text AS "source",
    reading.id::text AS "sourceId",
    'event_time_staff_attribution'::text AS "dimension",
    CASE
      WHEN reading.attributed_staff_participant_id IS NULL THEN 'exact'
      WHEN responsibility.id IS NULL OR participation.id IS NULL THEN 'orphan'
      WHEN responsibility.organization_id <> reading.organization_id
        OR responsibility.property_id <> reading.property_id
        OR responsibility.portal_id <> reading.portal_id
        OR responsibility.staff_participation_id <> reading.attributed_staff_participation_id
        OR participation.staff_participant_id <> reading.attributed_staff_participant_id
        THEN 'conflict'
      ELSE 'exact'
    END::text AS "outcome",
    reading.organization_id::text AS "organizationId",
    reading.property_id::text AS "propertyId",
    reading.portal_id::text AS "portalId",
    NULL::text AS "userId",
    CASE
      WHEN reading.attributed_staff_participant_id IS NULL
        THEN 'metric_reading_has_no_guest_staff_attribution'
      WHEN responsibility.id IS NULL THEN 'metric_reading_responsibility_missing'
      WHEN participation.id IS NULL THEN 'metric_reading_participation_missing'
      WHEN responsibility.organization_id <> reading.organization_id
        OR responsibility.property_id <> reading.property_id
        OR responsibility.portal_id <> reading.portal_id
        OR responsibility.staff_participation_id <> reading.attributed_staff_participation_id
        OR participation.staff_participant_id <> reading.attributed_staff_participant_id
        THEN 'metric_reading_attribution_scope_conflict'
      ELSE 'metric_reading_event_time_primary_exact'
    END::text AS "reasonCode",
    array_remove(ARRAY[
      reading.attributed_staff_participant_id::text,
      reading.attributed_staff_participation_id::text,
      reading.attribution_responsibility_id::text
    ], NULL) AS "relatedIds"
  FROM metric_readings reading
  LEFT JOIN portal_responsibilities responsibility
    ON responsibility.id = reading.attribution_responsibility_id
  LEFT JOIN staff_participations participation
    ON participation.id = reading.attributed_staff_participation_id

  UNION ALL

  SELECT
    'metric_correction'::text AS "source",
    correction.id::text AS "sourceId",
    'event_time_staff_attribution'::text AS "dimension",
    CASE
      WHEN reading.id IS NULL THEN 'orphan'
      WHEN ROW(
        correction.attributed_staff_participant_id,
        correction.attributed_staff_participation_id,
        correction.attribution_responsibility_id,
        correction.staff_attribution_effective_from,
        correction.staff_attribution_effective_to
      ) IS DISTINCT FROM ROW(
        reading.attributed_staff_participant_id,
        reading.attributed_staff_participation_id,
        reading.attribution_responsibility_id,
        reading.staff_attribution_effective_from,
        reading.staff_attribution_effective_to
      ) THEN 'conflict'
      ELSE 'exact'
    END::text AS "outcome",
    COALESCE(reading.organization_id::text, 'unknown') AS "organizationId",
    reading.property_id::text AS "propertyId",
    reading.portal_id::text AS "portalId",
    NULL::text AS "userId",
    CASE
      WHEN reading.id IS NULL THEN 'metric_correction_reading_missing'
      WHEN ROW(
        correction.attributed_staff_participant_id,
        correction.attributed_staff_participation_id,
        correction.attribution_responsibility_id,
        correction.staff_attribution_effective_from,
        correction.staff_attribution_effective_to
      ) IS DISTINCT FROM ROW(
        reading.attributed_staff_participant_id,
        reading.attributed_staff_participation_id,
        reading.attribution_responsibility_id,
        reading.staff_attribution_effective_from,
        reading.staff_attribution_effective_to
      ) THEN 'metric_correction_attribution_differs_from_reading'
      ELSE 'metric_correction_preserves_reading_attribution'
    END::text AS "reasonCode",
    array_remove(ARRAY[
      reading.id::text,
      correction.attributed_staff_participant_id::text,
      correction.attributed_staff_participation_id::text,
      correction.attribution_responsibility_id::text
    ], NULL) AS "relatedIds"
  FROM metric_corrections correction
  LEFT JOIN metric_readings reading ON reading.id = correction.reading_id
`
