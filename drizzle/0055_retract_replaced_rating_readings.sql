-- Retract the readings a corrected rating replaced and left effective (full-read
-- review 2026-10-14, S16-01).
--
-- One rating becomes three readings: the Portal's private rating, and the two
-- Goal measures rating count and rating average. A guest's correction replaces
-- all three, and the replacement retracts the earlier reading of each. Until
-- now it keyed that retraction by the rating fact alone (`<fact id>:retract`),
-- and `metric_corrections_source_unique` allows one row per key, so only the
-- first reading, the private rating, was retracted. The other two inserts were
-- swallowed as replays. The earlier count and average reading stayed effective
-- beside their replacements: the rating counted twice, and a Goal on either
-- measure quarantined (`correction_missing`) for every month holding a
-- corrected rating.
--
-- Data only, and additive. For each rating correction written that way it adds
-- the retraction the other readings of the replaced rating are missing, keyed
-- by the fact and the measure (`<fact id>:<definition version id>`), the way the
-- code now writes it. It deletes and updates nothing: corrections are
-- append-only, and the private rating's retraction keeps its old key, which
-- readers still accept.
--
-- A reading is given a retraction only when all of these hold: an old-style
-- retraction `<fact id>:retract` exists for a reading of the same rating (same
-- Organization, Property, Portal and group, same replaced source fact, another
-- measure); the correcting fact has a reading under this reading's own measure,
-- so it did replace it; and this reading has no correction of its own yet.
-- Each added row is attributed to the migration, carries the replacement's event
-- time, and copies the Staff attribution of the reading it retracts (the code
-- refuses a replacement whose attribution differs).
--
-- Idempotent: once a reading has a correction it no longer matches, and the
-- key is unique. Environments run the detection SELECT in
-- docs/operations/operator-commands.md before and after.
INSERT INTO "metric_corrections" (
	"reading_id", "source_event_id", "kind", "reason", "actor_type", "actor_id", "event_at",
	"attributed_staff_participant_id", "attributed_staff_participation_id",
	"attribution_responsibility_id", "staff_attribution_effective_from",
	"staff_attribution_effective_to"
)
SELECT prior."id",
	replacement."source_event_id" || ':' || prior."definition_version_id"::text,
	'retract', 'source_reconciliation', 'system', 'migration-0055', replacement."event_at",
	prior."attributed_staff_participant_id", prior."attributed_staff_participation_id",
	prior."attribution_responsibility_id", prior."staff_attribution_effective_from",
	prior."staff_attribution_effective_to"
FROM "metric_corrections" first_retraction
JOIN "metric_readings" first_prior ON first_prior."id" = first_retraction."reading_id"
JOIN "metric_readings" prior
	ON prior."organization_id" = first_prior."organization_id"
	AND prior."property_id" = first_prior."property_id"
	AND prior."portal_id" IS NOT DISTINCT FROM first_prior."portal_id"
	AND prior."group_id" IS NOT DISTINCT FROM first_prior."group_id"
	AND prior."source_event_id" = first_prior."source_event_id"
	AND prior."definition_version_id" <> first_prior."definition_version_id"
JOIN "metric_readings" replacement
	ON replacement."definition_version_id" = prior."definition_version_id"
	AND replacement."source_event_id" = left(first_retraction."source_event_id", -8)
	AND replacement."organization_id" = prior."organization_id"
	AND replacement."property_id" = prior."property_id"
	AND replacement."portal_id" IS NOT DISTINCT FROM prior."portal_id"
	AND replacement."group_id" IS NOT DISTINCT FROM prior."group_id"
WHERE first_retraction."kind" = 'retract'
	AND first_retraction."source_event_id" LIKE '%:retract'
	AND NOT EXISTS (
		SELECT 1 FROM "metric_corrections" existing
		WHERE existing."reading_id" = prior."id" AND existing."supersedes_correction_id" IS NULL
	)
ON CONFLICT ("source_event_id") DO NOTHING;
