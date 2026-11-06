-- Read-only candidates for review, not authority to change a closed outcome.
-- Compare the latest revision with current effective readings. Receipt and
-- attribution failures still need the governed read before any repair.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

WITH correction_tips AS (
  SELECT correction.*
  FROM metric_corrections correction
  WHERE NOT EXISTS (
    SELECT 1 FROM metric_corrections successor
    WHERE successor.supersedes_correction_id = correction.id
  )
), heads AS (
  SELECT result.id, result.organization_id, result.property_id, result.program_id,
    result.period_start, result.period_end, assignment.subject_kind,
    assignment.portal_id, assignment.portal_group_id,
    version.metric_definition_version_id, version.metric_key,
    version.metric_minimum_sample,
    CASE WHEN revision.id IS NULL THEN result.value ELSE revision.value END AS value,
    CASE WHEN revision.id IS NULL THEN result.sample_count ELSE revision.sample_count END AS sample_count,
    CASE WHEN revision.id IS NULL THEN result.evaluation_state ELSE revision.evaluation_state END AS evaluation_state
  FROM goal_monthly_results result
  JOIN goal_program_versions version
    ON version.id = result.program_version_id
   AND version.organization_id = result.organization_id
   AND version.property_id = result.property_id
   AND version.program_id = result.program_id
  JOIN goal_subject_assignments assignment
    ON assignment.id = result.assignment_id
   AND assignment.organization_id = result.organization_id
   AND assignment.property_id = result.property_id
   AND assignment.program_id = result.program_id
   AND assignment.program_version_id = result.program_version_id
  LEFT JOIN LATERAL (
    SELECT candidate.* FROM goal_result_revisions candidate
    WHERE candidate.monthly_result_id = result.id
      AND candidate.organization_id = result.organization_id
      AND candidate.property_id = result.property_id
    ORDER BY candidate.revision DESC LIMIT 1
  ) revision ON true
  WHERE result.status = 'closed'
), compared AS (
  SELECT head.*, current_readings.sample_count AS current_sample_count,
    CASE
      WHEN current_readings.sample_count < head.metric_minimum_sample THEN NULL
      WHEN head.metric_key = 'portal_rating_average'
        THEN round(current_readings.weighted_sum / NULLIF(current_readings.sample_count, 0), 1)
      ELSE current_readings.total
    END AS current_value
  FROM heads head
  CROSS JOIN LATERAL (
    SELECT COALESCE(sum(effective.value), 0) AS total,
      COALESCE(sum(effective.value * effective.sample_count), 0) AS weighted_sum,
      COALESCE(sum(effective.sample_count), 0) AS sample_count
    FROM (
      SELECT CASE correction.kind
          WHEN 'retract' THEN NULL
          WHEN 'replace' THEN correction.replacement_value
          WHEN 'adjust' THEN reading.exact_value + correction.exact_delta
          ELSE reading.exact_value
        END AS value,
        CASE WHEN correction.kind = 'retract' THEN 0 ELSE reading.sample_count END AS sample_count
      FROM metric_readings reading
      LEFT JOIN correction_tips correction ON correction.reading_id = reading.id
      WHERE reading.organization_id = head.organization_id
        AND reading.property_id = head.property_id
        AND reading.definition_version_id = head.metric_definition_version_id
        AND reading.event_at >= head.period_start
        AND reading.event_at < head.period_end
        AND reading.exact_value IS NOT NULL
        AND (
          head.subject_kind = 'property'
          OR (head.subject_kind = 'portal' AND reading.portal_id = head.portal_id)
          OR (head.subject_kind = 'portal_group' AND reading.group_id = head.portal_group_id)
        )
    ) effective
  ) current_readings
)
SELECT id AS monthly_result_id, organization_id, property_id, program_id
FROM compared
WHERE sample_count IS DISTINCT FROM current_sample_count
   OR (evaluation_state IN ('eligible', 'insufficient_data') AND value IS DISTINCT FROM current_value)
ORDER BY organization_id, property_id, id;

ROLLBACK;
