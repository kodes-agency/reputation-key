-- PPL-01: immutable event-time Primary Staff attribution.
-- Supporting responsibilities are intentionally absent from every resolver,
-- backfill, fact, and projection below.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM portal_responsibilities left_primary
    JOIN portal_responsibilities right_primary
      ON right_primary.organization_id = left_primary.organization_id
     AND right_primary.property_id = left_primary.property_id
     AND right_primary.portal_id = left_primary.portal_id
     AND right_primary.kind = 'primary'
     AND right_primary.id > left_primary.id
     AND tstzrange(
       right_primary.effective_from,
       right_primary.effective_to,
       '[)'
     ) && tstzrange(
       left_primary.effective_from,
       left_primary.effective_to,
       '[)'
     )
    WHERE left_primary.kind = 'primary'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'primary Staff attribution contains overlapping retained intervals';
  END IF;
END
$$;
--> statement-breakpoint
CREATE UNIQUE INDEX "sp_org_property_id_participant_key"
ON "staff_participations" USING btree (
  "organization_id", "property_id", "id", "staff_participant_id"
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pr_scope_id_participation_key"
ON "portal_responsibilities" USING btree (
  "organization_id", "property_id", "portal_id", "id", "staff_participation_id"
);
--> statement-breakpoint
ALTER TABLE "portal_responsibilities"
ADD CONSTRAINT "pr_portal_tenant_fk"
FOREIGN KEY ("organization_id", "property_id", "portal_id")
REFERENCES "public"."portals"("organization_id", "property_id", "id")
ON DELETE restrict NOT VALID;
--> statement-breakpoint
ALTER TABLE "portal_responsibilities"
VALIDATE CONSTRAINT "pr_portal_tenant_fk";
--> statement-breakpoint
ALTER TABLE "portal_responsibilities"
ADD CONSTRAINT "pr_no_overlapping_primary_intervals"
EXCLUDE USING gist (
  "organization_id" WITH =,
  "property_id" WITH =,
  "portal_id" WITH =,
  tstzrange("effective_from", "effective_to", '[)') WITH &&
)
WHERE ("kind" = 'primary');
--> statement-breakpoint
ALTER TABLE "guest_qualified_scans"
  ADD COLUMN "attributed_staff_participant_id" uuid,
  ADD COLUMN "attributed_staff_participation_id" uuid,
  ADD COLUMN "attribution_responsibility_id" uuid,
  ADD COLUMN "staff_attribution_effective_from" timestamp with time zone,
  ADD COLUMN "staff_attribution_effective_to" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "guest_responses"
  ADD COLUMN "attributed_staff_participant_id" uuid,
  ADD COLUMN "attributed_staff_participation_id" uuid,
  ADD COLUMN "attribution_responsibility_id" uuid,
  ADD COLUMN "staff_attribution_effective_from" timestamp with time zone,
  ADD COLUMN "staff_attribution_effective_to" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "metric_readings"
  ADD COLUMN "attributed_staff_participant_id" uuid,
  ADD COLUMN "attributed_staff_participation_id" uuid,
  ADD COLUMN "attribution_responsibility_id" uuid,
  ADD COLUMN "staff_attribution_effective_from" timestamp with time zone,
  ADD COLUMN "staff_attribution_effective_to" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "metric_corrections"
  ADD COLUMN "attributed_staff_participant_id" uuid,
  ADD COLUMN "attributed_staff_participation_id" uuid,
  ADD COLUMN "attribution_responsibility_id" uuid,
  ADD COLUMN "staff_attribution_effective_from" timestamp with time zone,
  ADD COLUMN "staff_attribution_effective_to" timestamp with time zone;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    WITH guest_fact AS (
      SELECT organization_id, property_id, portal_id, occurred_at AS observed_at
      FROM guest_qualified_scans
      UNION ALL
      SELECT organization_id, property_id, portal_id, submitted_at AS observed_at
      FROM guest_responses
      WHERE submitted_at IS NOT NULL
    )
    SELECT 1
    FROM guest_fact fact
    JOIN portal_responsibilities responsibility
      ON responsibility.organization_id = fact.organization_id
     AND responsibility.property_id = fact.property_id
     AND responsibility.portal_id = fact.portal_id
     AND responsibility.kind = 'primary'
     AND responsibility.effective_from <= fact.observed_at
     AND (
       responsibility.effective_to IS NULL
       OR responsibility.effective_to > fact.observed_at
     )
    LEFT JOIN staff_participations participation
      ON participation.organization_id = responsibility.organization_id
     AND participation.property_id = responsibility.property_id
     AND participation.id = responsibility.staff_participation_id
    LEFT JOIN staff_participants participant
      ON participant.organization_id = participation.organization_id
     AND participant.id = participation.staff_participant_id
    WHERE participation.id IS NULL
       OR participation.staff_participant_id IS NULL
       OR participation.started_at > fact.observed_at
       OR participation.ended_at <= fact.observed_at
       OR participant.id IS NULL
       OR participant.created_at > fact.observed_at
       OR participant.archived_at <= fact.observed_at
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'primary Staff attribution contains corrupt Guest event-time authority';
  END IF;
END
$$;
--> statement-breakpoint
WITH candidate AS (
  SELECT
    scan.id AS guest_fact_id,
    participation.staff_participant_id,
    responsibility.staff_participation_id,
    responsibility.id AS portal_responsibility_id,
    responsibility.effective_from,
    responsibility.effective_to
  FROM guest_qualified_scans scan
  JOIN portal_responsibilities responsibility
    ON responsibility.organization_id = scan.organization_id
   AND responsibility.property_id = scan.property_id
   AND responsibility.portal_id = scan.portal_id
   AND responsibility.kind = 'primary'
   AND responsibility.effective_from <= scan.occurred_at
   AND (
     responsibility.effective_to IS NULL
     OR responsibility.effective_to > scan.occurred_at
   )
  JOIN staff_participations participation
    ON participation.organization_id = responsibility.organization_id
   AND participation.property_id = responsibility.property_id
   AND participation.id = responsibility.staff_participation_id
)
UPDATE guest_qualified_scans scan
SET
  attributed_staff_participant_id = candidate.staff_participant_id,
  attributed_staff_participation_id = candidate.staff_participation_id,
  attribution_responsibility_id = candidate.portal_responsibility_id,
  staff_attribution_effective_from = candidate.effective_from,
  staff_attribution_effective_to = candidate.effective_to
FROM candidate
WHERE scan.id = candidate.guest_fact_id;
--> statement-breakpoint
WITH candidate AS (
  SELECT
    response.id AS guest_fact_id,
    participation.staff_participant_id,
    responsibility.staff_participation_id,
    responsibility.id AS portal_responsibility_id,
    responsibility.effective_from,
    responsibility.effective_to
  FROM guest_responses response
  JOIN portal_responsibilities responsibility
    ON responsibility.organization_id = response.organization_id
   AND responsibility.property_id = response.property_id
   AND responsibility.portal_id = response.portal_id
   AND responsibility.kind = 'primary'
   AND responsibility.effective_from <= response.submitted_at
   AND (
     responsibility.effective_to IS NULL
     OR responsibility.effective_to > response.submitted_at
   )
  JOIN staff_participations participation
    ON participation.organization_id = responsibility.organization_id
   AND participation.property_id = responsibility.property_id
   AND participation.id = responsibility.staff_participation_id
  WHERE response.submitted_at IS NOT NULL
)
UPDATE guest_responses response
SET
  attributed_staff_participant_id = candidate.staff_participant_id,
  attributed_staff_participation_id = candidate.staff_participation_id,
  attribution_responsibility_id = candidate.portal_responsibility_id,
  staff_attribution_effective_from = candidate.effective_from,
  staff_attribution_effective_to = candidate.effective_to
FROM candidate
WHERE response.id = candidate.guest_fact_id;
--> statement-breakpoint
WITH guest_source_attribution AS (
  SELECT
    scan.source_event_id::text AS source_event_id,
    scan.attributed_staff_participant_id,
    scan.attributed_staff_participation_id,
    scan.attribution_responsibility_id,
    scan.staff_attribution_effective_from,
    scan.staff_attribution_effective_to
  FROM guest_qualified_scans scan
  UNION ALL
  SELECT
    event.id::text AS source_event_id,
    response.attributed_staff_participant_id,
    response.attributed_staff_participation_id,
    response.attribution_responsibility_id,
    response.staff_attribution_effective_from,
    response.staff_attribution_effective_to
  FROM outbox_events event
  JOIN guest_responses response
    ON response.organization_id = event.organization_id
   AND response.id::text = COALESCE(
     event.payload ->> 'ratingId',
     event.payload ->> 'feedbackId'
   )
  WHERE event.event_type IN (
    'guest.rating.submitted',
    'guest.feedback.submitted'
  )
)
UPDATE metric_readings reading
SET
  attributed_staff_participant_id = attribution.attributed_staff_participant_id,
  attributed_staff_participation_id = attribution.attributed_staff_participation_id,
  attribution_responsibility_id = attribution.attribution_responsibility_id,
  staff_attribution_effective_from = attribution.staff_attribution_effective_from,
  staff_attribution_effective_to = attribution.staff_attribution_effective_to
FROM guest_source_attribution attribution
WHERE reading.source_event_id = attribution.source_event_id;
--> statement-breakpoint
UPDATE metric_corrections correction
SET
  attributed_staff_participant_id = reading.attributed_staff_participant_id,
  attributed_staff_participation_id = reading.attributed_staff_participation_id,
  attribution_responsibility_id = reading.attribution_responsibility_id,
  staff_attribution_effective_from = reading.staff_attribution_effective_from,
  staff_attribution_effective_to = reading.staff_attribution_effective_to
FROM metric_readings reading
WHERE reading.id = correction.reading_id;
--> statement-breakpoint
ALTER TABLE "guest_qualified_scans"
ADD CONSTRAINT "guest_qualified_scans_staff_attribution_complete"
CHECK (
  (
    "attributed_staff_participant_id" IS NULL
    AND "attributed_staff_participation_id" IS NULL
    AND "attribution_responsibility_id" IS NULL
    AND "staff_attribution_effective_from" IS NULL
    AND "staff_attribution_effective_to" IS NULL
  )
  OR
  (
    "attributed_staff_participant_id" IS NOT NULL
    AND "attributed_staff_participation_id" IS NOT NULL
    AND "attribution_responsibility_id" IS NOT NULL
    AND "staff_attribution_effective_from" IS NOT NULL
    AND (
      "staff_attribution_effective_to" IS NULL
      OR "staff_attribution_effective_to" > "staff_attribution_effective_from"
    )
    AND "occurred_at" >= "staff_attribution_effective_from"
    AND (
      "staff_attribution_effective_to" IS NULL
      OR "occurred_at" < "staff_attribution_effective_to"
    )
  )
);
--> statement-breakpoint
ALTER TABLE "guest_responses"
ADD CONSTRAINT "guest_responses_staff_attribution_complete"
CHECK (
  (
    "attributed_staff_participant_id" IS NULL
    AND "attributed_staff_participation_id" IS NULL
    AND "attribution_responsibility_id" IS NULL
    AND "staff_attribution_effective_from" IS NULL
    AND "staff_attribution_effective_to" IS NULL
  )
  OR
  (
    "attributed_staff_participant_id" IS NOT NULL
    AND "attributed_staff_participation_id" IS NOT NULL
    AND "attribution_responsibility_id" IS NOT NULL
    AND "staff_attribution_effective_from" IS NOT NULL
    AND "submitted_at" IS NOT NULL
    AND "submitted_at" >= "staff_attribution_effective_from"
    AND (
      "staff_attribution_effective_to" IS NULL
      OR "staff_attribution_effective_to" > "staff_attribution_effective_from"
    )
    AND (
      "staff_attribution_effective_to" IS NULL
      OR "submitted_at" < "staff_attribution_effective_to"
    )
  )
);
--> statement-breakpoint
ALTER TABLE "metric_readings"
ADD CONSTRAINT "metric_readings_staff_attribution_complete"
CHECK (
  (
    "attributed_staff_participant_id" IS NULL
    AND "attributed_staff_participation_id" IS NULL
    AND "attribution_responsibility_id" IS NULL
    AND "staff_attribution_effective_from" IS NULL
    AND "staff_attribution_effective_to" IS NULL
  )
  OR
  (
    "portal_id" IS NOT NULL
    AND "attributed_staff_participant_id" IS NOT NULL
    AND "attributed_staff_participation_id" IS NOT NULL
    AND "attribution_responsibility_id" IS NOT NULL
    AND "staff_attribution_effective_from" IS NOT NULL
    AND (
      "staff_attribution_effective_to" IS NULL
      OR "staff_attribution_effective_to" > "staff_attribution_effective_from"
    )
  )
);
--> statement-breakpoint
ALTER TABLE "metric_corrections"
ADD CONSTRAINT "metric_corrections_staff_attribution_complete"
CHECK (
  (
    "attributed_staff_participant_id" IS NULL
    AND "attributed_staff_participation_id" IS NULL
    AND "attribution_responsibility_id" IS NULL
    AND "staff_attribution_effective_from" IS NULL
    AND "staff_attribution_effective_to" IS NULL
  )
  OR
  (
    "attributed_staff_participant_id" IS NOT NULL
    AND "attributed_staff_participation_id" IS NOT NULL
    AND "attribution_responsibility_id" IS NOT NULL
    AND "staff_attribution_effective_from" IS NOT NULL
    AND (
      "staff_attribution_effective_to" IS NULL
      OR "staff_attribution_effective_to" > "staff_attribution_effective_from"
    )
  )
);
--> statement-breakpoint
ALTER TABLE "guest_qualified_scans"
ADD CONSTRAINT "guest_qualified_scans_participant_scope_fk"
FOREIGN KEY (
  "organization_id", "property_id",
  "attributed_staff_participation_id", "attributed_staff_participant_id"
)
REFERENCES "public"."staff_participations"(
  "organization_id", "property_id", "id", "staff_participant_id"
)
ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "guest_qualified_scans"
ADD CONSTRAINT "guest_qualified_scans_responsibility_scope_fk"
FOREIGN KEY (
  "organization_id", "property_id", "portal_id",
  "attribution_responsibility_id", "attributed_staff_participation_id"
)
REFERENCES "public"."portal_responsibilities"(
  "organization_id", "property_id", "portal_id", "id", "staff_participation_id"
)
ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "guest_responses"
ADD CONSTRAINT "guest_responses_participant_scope_fk"
FOREIGN KEY (
  "organization_id", "property_id",
  "attributed_staff_participation_id", "attributed_staff_participant_id"
)
REFERENCES "public"."staff_participations"(
  "organization_id", "property_id", "id", "staff_participant_id"
)
ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "guest_responses"
ADD CONSTRAINT "guest_responses_responsibility_scope_fk"
FOREIGN KEY (
  "organization_id", "property_id", "portal_id",
  "attribution_responsibility_id", "attributed_staff_participation_id"
)
REFERENCES "public"."portal_responsibilities"(
  "organization_id", "property_id", "portal_id", "id", "staff_participation_id"
)
ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "metric_readings"
ADD CONSTRAINT "metric_readings_staff_participant_scope_fk"
FOREIGN KEY (
  "organization_id", "property_id",
  "attributed_staff_participation_id", "attributed_staff_participant_id"
)
REFERENCES "public"."staff_participations"(
  "organization_id", "property_id", "id", "staff_participant_id"
)
ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "metric_readings"
ADD CONSTRAINT "metric_readings_staff_responsibility_scope_fk"
FOREIGN KEY (
  "organization_id", "property_id", "portal_id",
  "attribution_responsibility_id", "attributed_staff_participation_id"
)
REFERENCES "public"."portal_responsibilities"(
  "organization_id", "property_id", "portal_id", "id", "staff_participation_id"
)
ON DELETE restrict;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "guard_primary_staff_attribution_immutable_v1"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW.attributed_staff_participant_id,
    NEW.attributed_staff_participation_id,
    NEW.attribution_responsibility_id,
    NEW.staff_attribution_effective_from,
    NEW.staff_attribution_effective_to
  ) IS DISTINCT FROM ROW(
    OLD.attributed_staff_participant_id,
    OLD.attributed_staff_participation_id,
    OLD.attribution_responsibility_id,
    OLD.staff_attribution_effective_from,
    OLD.staff_attribution_effective_to
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'event-time Primary Staff attribution is immutable';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "guest_qualified_scans_staff_attribution_immutable"
BEFORE UPDATE OF
  "attributed_staff_participant_id",
  "attributed_staff_participation_id",
  "attribution_responsibility_id",
  "staff_attribution_effective_from",
  "staff_attribution_effective_to"
ON "guest_qualified_scans"
FOR EACH ROW
EXECUTE FUNCTION "guard_primary_staff_attribution_immutable_v1"();
--> statement-breakpoint
CREATE TRIGGER "guest_responses_staff_attribution_immutable"
BEFORE UPDATE OF
  "attributed_staff_participant_id",
  "attributed_staff_participation_id",
  "attribution_responsibility_id",
  "staff_attribution_effective_from",
  "staff_attribution_effective_to"
ON "guest_responses"
FOR EACH ROW
EXECUTE FUNCTION "guard_primary_staff_attribution_immutable_v1"();
--> statement-breakpoint
CREATE TRIGGER "metric_readings_staff_attribution_immutable"
BEFORE UPDATE OF
  "attributed_staff_participant_id",
  "attributed_staff_participation_id",
  "attribution_responsibility_id",
  "staff_attribution_effective_from",
  "staff_attribution_effective_to"
ON "metric_readings"
FOR EACH ROW
EXECUTE FUNCTION "guard_primary_staff_attribution_immutable_v1"();
--> statement-breakpoint
CREATE TRIGGER "metric_corrections_staff_attribution_immutable"
BEFORE UPDATE OF
  "attributed_staff_participant_id",
  "attributed_staff_participation_id",
  "attribution_responsibility_id",
  "staff_attribution_effective_from",
  "staff_attribution_effective_to"
ON "metric_corrections"
FOR EACH ROW
EXECUTE FUNCTION "guard_primary_staff_attribution_immutable_v1"();
