-- Unified source Handling Cycles for Review and Guest private feedback.
-- Expand and backfill before contract: no existing cycle history is rewritten
-- semantically, and legacy rows receive explicit system-attributed evidence.

CREATE TABLE "inbox_handling_cycle_transitions" (
	"inbox_item_id" uuid NOT NULL,
	"state_revision" bigint NOT NULL,
	"cycle_number" bigint NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"source_type" "inbox_source_type" NOT NULL,
	"source_id" uuid NOT NULL,
	"source_revision" bigint NOT NULL,
	"kind" varchar(16) NOT NULL,
	"transition_reason" varchar(48) NOT NULL,
	"actor_type" varchar(16) NOT NULL,
	"actor_user_id" varchar(255),
	"trigger_event_id" uuid,
	"transitioned_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_handling_cycle_transitions_pk" PRIMARY KEY("inbox_item_id","state_revision"),
	CONSTRAINT "inbox_handling_cycle_transitions_values_valid" CHECK (
        "cycle_number" BETWEEN 1 AND '9007199254740991'::bigint
        AND "state_revision" BETWEEN 1 AND '9007199254740991'::bigint
        AND "source_revision" BETWEEN 1 AND '9007199254740991'::bigint
        AND "kind" IN ('opened', 'closed', 'reopened')
        AND "transition_reason" IN (
          'legacy_backfill', 'review_observed', 'feedback_submitted',
          'material_revision_changed', 'manual_reopen',
          'provider_reply_deleted', 'provider_reply_diverged',
          'guest_follow_up_still_needed', 'internal_follow_up_still_needed',
          'new_information', 'correcting_handling_status', 'other',
          'confirmed_on_google', 'external_reply_observed', 'guest_withdrawn',
          'private_feedback_handled', 'source_ineligible',
          'superseded_by_source_revision'
        )
        AND "actor_type" IN ('user', 'guest', 'provider', 'system')
        AND (("actor_type" = 'user') = ("actor_user_id" IS NOT NULL))
      )
);--> statement-breakpoint

ALTER TABLE "inbox_handling_cycle_heads"
  DROP CONSTRAINT "inbox_handling_cycle_heads_revisions_safe";--> statement-breakpoint
ALTER TABLE "inbox_handling_cycles"
  DROP CONSTRAINT "inbox_handling_cycles_reason_valid";--> statement-breakpoint

ALTER TABLE "inbox_handling_cycle_heads" ALTER COLUMN "review_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_handling_cycle_heads" ALTER COLUMN "current_material_review_revision" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_handling_cycles" ALTER COLUMN "review_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_handling_cycles" ALTER COLUMN "material_review_revision" DROP NOT NULL;--> statement-breakpoint

ALTER TABLE "guest_responses" ADD COLUMN "feedback_submission_revision" integer;--> statement-breakpoint
ALTER TABLE "inbox_handling_cycle_heads" ADD COLUMN "source_type" "inbox_source_type";--> statement-breakpoint
ALTER TABLE "inbox_handling_cycle_heads" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "inbox_handling_cycle_heads" ADD COLUMN "current_source_revision" bigint;--> statement-breakpoint
ALTER TABLE "inbox_handling_cycles" ADD COLUMN "source_type" "inbox_source_type";--> statement-breakpoint
ALTER TABLE "inbox_handling_cycles" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "inbox_handling_cycles" ADD COLUMN "source_revision" bigint;--> statement-breakpoint

DO $$
DECLARE
  ambiguous_count bigint;
BEGIN
  SELECT count(*) INTO ambiguous_count
  FROM "guest_responses"
  WHERE "feedback_submitted_at" IS NOT NULL
    AND "feedback_submission_revision" IS NULL
    AND "correction_count" > 0
    AND (
      "corrected_at" IS NULL
      -- With more than one correction and feedback preceding only the latest
      -- corrected_at, the exact intermediate revision is not reconstructible.
      OR ("correction_count" > 1 AND "feedback_submitted_at" < "corrected_at")
    );
  IF ambiguous_count > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = 'guest feedback submission revision backfill is ambiguous',
      DETAIL = format('%s row(s) require correction-history repair before 0132', ambiguous_count);
  END IF;
END;
$$;--> statement-breakpoint

UPDATE "guest_responses"
SET "feedback_submission_revision" = CASE
  WHEN "correction_count" = 0 THEN 1
  -- Feedback submitted by the latest correction shares corrected_at and
  -- therefore belongs to revision correction_count + 1. A feedback timestamp
  -- before the sole correction is provably revision one; earlier feedback in
  -- a multi-correction history was rejected as ambiguous above.
  WHEN "feedback_submitted_at" >= "corrected_at" THEN "correction_count" + 1
  ELSE 1
END
WHERE "feedback_submitted_at" IS NOT NULL
  AND "feedback_submission_revision" IS NULL;--> statement-breakpoint

-- The opening table is protected by an ALWAYS immutability trigger. Temporarily
-- disable it only for the mechanical addition of equivalent source aliases.
ALTER TABLE "inbox_handling_cycles" DISABLE TRIGGER "inbox_handling_cycles_immutable";--> statement-breakpoint
UPDATE "inbox_handling_cycles"
SET "source_type" = 'review',
    "source_id" = "review_id",
    "source_revision" = "material_review_revision"
WHERE "source_type" IS NULL;--> statement-breakpoint
ALTER TABLE "inbox_handling_cycles" ENABLE ALWAYS TRIGGER "inbox_handling_cycles_immutable";--> statement-breakpoint

UPDATE "inbox_handling_cycle_heads"
SET "source_type" = 'review',
    "source_id" = "review_id",
    "current_source_revision" = "current_material_review_revision"
WHERE "source_type" IS NULL;--> statement-breakpoint

-- Existing feedback items gain one stable legacy cycle. Current aggregate
-- feedback uses its newly backfilled submission revision; legacy storage uses
-- revision one. Invalid legacy text Property keys remain quarantined rather
-- than aborting the contract migration.
INSERT INTO "inbox_handling_cycles" (
  "inbox_item_id", "cycle_number", "organization_id", "property_id",
  "source_type", "source_id", "source_revision", "review_id",
  "material_review_revision", "opened_reason", "manual_reopen_reason",
  "manual_reopen_explanation", "supersedes_cycle_number", "opened_by",
  "opened_at", "created_at"
)
SELECT item."id", 1, item."organization_id", item."property_id"::uuid,
       'feedback', item."source_id",
       COALESCE(response."feedback_submission_revision", 1), NULL, NULL,
       'legacy_backfill', NULL, NULL, NULL, NULL,
       item."created_at", item."created_at"
FROM "inbox_items" AS item
LEFT JOIN "guest_responses" AS response
  ON response."id" = item."source_id"
 AND response."organization_id" = item."organization_id"
WHERE item."source_type" = 'feedback'
  AND item."property_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND NOT EXISTS (
    SELECT 1 FROM "inbox_handling_cycles" AS cycle
    WHERE cycle."inbox_item_id" = item."id"
  );--> statement-breakpoint

INSERT INTO "inbox_handling_cycle_heads" (
  "inbox_item_id", "organization_id", "property_id", "source_type",
  "source_id", "current_cycle_number", "current_source_revision",
  "review_id", "current_material_review_revision", "state_revision",
  "status", "created_at", "updated_at"
)
SELECT item."id", item."organization_id", item."property_id"::uuid,
       'feedback', item."source_id", cycle."cycle_number",
       cycle."source_revision", NULL, NULL, 1, item."status",
       item."created_at", item."updated_at"
FROM "inbox_items" AS item
JOIN "inbox_handling_cycles" AS cycle
  ON cycle."inbox_item_id" = item."id"
 AND cycle."source_type" = 'feedback'
WHERE item."source_type" = 'feedback'
  AND NOT EXISTS (
    SELECT 1 FROM "inbox_handling_cycle_heads" AS head
    WHERE head."inbox_item_id" = item."id"
  );--> statement-breakpoint

-- Backfill one immutable opening transition per historical cycle. These rows
-- are explicitly legacy evidence; no provider/user attribution is inferred.
INSERT INTO "inbox_handling_cycle_transitions" (
  "inbox_item_id", "state_revision", "cycle_number", "organization_id",
  "property_id", "source_type", "source_id", "source_revision", "kind",
  "transition_reason", "actor_type", "actor_user_id", "trigger_event_id",
  "transitioned_at", "created_at"
)
SELECT cycle."inbox_item_id", cycle."cycle_number", cycle."cycle_number",
       cycle."organization_id", cycle."property_id", cycle."source_type",
       cycle."source_id", cycle."source_revision",
       CASE
         WHEN cycle."opened_reason" IN (
           'manual_reopen', 'provider_reply_deleted', 'provider_reply_diverged'
         ) THEN 'reopened'
         ELSE 'opened'
       END,
       CASE
         WHEN cycle."opened_reason" = 'manual_reopen'
           THEN COALESCE(cycle."manual_reopen_reason", 'other')
         ELSE cycle."opened_reason"
       END,
       'system', NULL, NULL, cycle."opened_at", cycle."created_at"
FROM "inbox_handling_cycles" AS cycle
ON CONFLICT ("inbox_item_id", "state_revision") DO NOTHING;--> statement-breakpoint

-- Preserve an observable terminal fact for a legacy current head when its
-- exact historical close cause cannot be reconstructed.
INSERT INTO "inbox_handling_cycle_transitions" (
  "inbox_item_id", "state_revision", "cycle_number", "organization_id",
  "property_id", "source_type", "source_id", "source_revision", "kind",
  "transition_reason", "actor_type", "actor_user_id", "trigger_event_id",
  "transitioned_at", "created_at"
)
SELECT head."inbox_item_id", head."state_revision", head."current_cycle_number",
       head."organization_id", head."property_id", head."source_type",
       head."source_id", head."current_source_revision", 'closed',
       'external_reply_observed', 'system', NULL, NULL,
       head."updated_at", head."updated_at"
FROM "inbox_handling_cycle_heads" AS head
WHERE head."status" = 'closed'
ON CONFLICT ("inbox_item_id", "state_revision") DO NOTHING;--> statement-breakpoint

ALTER TABLE "inbox_handling_cycle_heads" ALTER COLUMN "source_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_handling_cycle_heads" ALTER COLUMN "source_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_handling_cycle_heads" ALTER COLUMN "current_source_revision" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_handling_cycles" ALTER COLUMN "source_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_handling_cycles" ALTER COLUMN "source_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_handling_cycles" ALTER COLUMN "source_revision" SET NOT NULL;--> statement-breakpoint

CREATE UNIQUE INDEX "inbox_items_cycle_source_scope_unique"
  ON "inbox_items" USING btree ("id","organization_id","source_type","source_id");--> statement-breakpoint

ALTER TABLE "inbox_handling_cycle_transitions" ADD CONSTRAINT "inbox_handling_cycle_transitions_cycle_fk"
  FOREIGN KEY ("inbox_item_id","cycle_number")
  REFERENCES "public"."inbox_handling_cycles"("inbox_item_id","cycle_number")
  ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_handling_cycle_transitions" ADD CONSTRAINT "inbox_handling_cycle_transitions_source_scope_fk"
  FOREIGN KEY ("inbox_item_id","organization_id","source_type","source_id")
  REFERENCES "public"."inbox_items"("id","organization_id","source_type","source_id")
  ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_handling_cycle_heads" ADD CONSTRAINT "inbox_handling_cycle_heads_source_scope_fk"
  FOREIGN KEY ("inbox_item_id","organization_id","source_type","source_id")
  REFERENCES "public"."inbox_items"("id","organization_id","source_type","source_id")
  ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_handling_cycles" ADD CONSTRAINT "inbox_handling_cycles_source_scope_fk"
  FOREIGN KEY ("inbox_item_id","organization_id","source_type","source_id")
  REFERENCES "public"."inbox_items"("id","organization_id","source_type","source_id")
  ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "inbox_handling_cycle_transitions_scope_idx"
  ON "inbox_handling_cycle_transitions" USING btree ("organization_id","property_id","inbox_item_id","state_revision");--> statement-breakpoint
CREATE INDEX "inbox_handling_cycle_transitions_source_idx"
  ON "inbox_handling_cycle_transitions" USING btree ("source_type","source_id","source_revision");--> statement-breakpoint
CREATE INDEX "inbox_handling_cycles_source_revision_idx"
  ON "inbox_handling_cycles" USING btree ("source_type","source_id","source_revision","cycle_number");--> statement-breakpoint

ALTER TABLE "guest_responses" ADD CONSTRAINT "guest_responses_feedback_submission_revision_valid"
  CHECK (("feedback_submitted_at" IS NULL AND "feedback_submission_revision" IS NULL)
    OR ("feedback_submitted_at" IS NOT NULL
      AND "feedback_submission_revision" BETWEEN 1 AND "correction_count" + 1));--> statement-breakpoint
ALTER TABLE "inbox_handling_cycle_heads" ADD CONSTRAINT "inbox_handling_cycle_heads_source_anchor_valid"
  CHECK (("source_type" = 'review'
      AND "review_id" = "source_id"
      AND "current_material_review_revision" = "current_source_revision")
    OR ("source_type" = 'feedback'
      AND "review_id" IS NULL
      AND "current_material_review_revision" IS NULL));--> statement-breakpoint
ALTER TABLE "inbox_handling_cycle_heads" ADD CONSTRAINT "inbox_handling_cycle_heads_revisions_safe"
  CHECK ("current_cycle_number" BETWEEN 1 AND '9007199254740991'::bigint
    AND "current_source_revision" BETWEEN 1 AND '9007199254740991'::bigint
    AND "state_revision" BETWEEN 1 AND '9007199254740991'::bigint);--> statement-breakpoint
ALTER TABLE "inbox_handling_cycles" ADD CONSTRAINT "inbox_handling_cycles_source_anchor_valid"
  CHECK ("source_revision" BETWEEN 1 AND '9007199254740991'::bigint
    AND (("source_type" = 'review'
      AND "review_id" = "source_id"
      AND "material_review_revision" = "source_revision"
      AND "opened_reason" <> 'feedback_submitted')
    OR ("source_type" = 'feedback'
      AND "review_id" IS NULL
      AND "material_review_revision" IS NULL
      AND "opened_reason" IN ('legacy_backfill', 'feedback_submitted', 'manual_reopen'))));--> statement-breakpoint
ALTER TABLE "inbox_handling_cycles" ADD CONSTRAINT "inbox_handling_cycles_reason_valid"
  CHECK ("opened_reason" IN (
    'legacy_backfill', 'review_observed', 'feedback_submitted',
    'material_revision_changed', 'manual_reopen',
    'provider_reply_deleted', 'provider_reply_diverged'
  ));
