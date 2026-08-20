ALTER TABLE "ai_operations" DROP CONSTRAINT "ai_operations_safe_integers";--> statement-breakpoint
ALTER TABLE "ai_operations" ADD COLUMN "reply_adoption_disposition" varchar(20) DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_operations" ADD COLUMN "adopted_reply_revision" bigint;--> statement-breakpoint
ALTER TABLE "ai_operations" ADD COLUMN "adopted_review_reply_state_revision" bigint;--> statement-breakpoint
ALTER TABLE "ai_operations" ADD CONSTRAINT "ai_operations_reply_adoption_valid" CHECK ((
        (
          "ai_operations"."command" = 'reply'
          AND "ai_operations"."reply_adoption_disposition" IN ('none', 'adopted', 'invalidated')
          AND (
            ("ai_operations"."reply_adoption_disposition" = 'none'
              AND "ai_operations"."adopted_reply_revision" IS NULL
              AND "ai_operations"."adopted_review_reply_state_revision" IS NULL)
            OR ("ai_operations"."reply_adoption_disposition" IN ('adopted', 'invalidated')
              AND "ai_operations"."adopted_reply_revision" >= 1
              AND "ai_operations"."adopted_review_reply_state_revision" >= 1)
          )
        )
        OR (
          "ai_operations"."command" <> 'reply'
          AND "ai_operations"."reply_adoption_disposition" = 'none'
          AND "ai_operations"."adopted_reply_revision" IS NULL
          AND "ai_operations"."adopted_review_reply_state_revision" IS NULL
        )
      ));--> statement-breakpoint
ALTER TABLE "ai_operations" ADD CONSTRAINT "ai_operations_safe_integers" CHECK (COALESCE("ai_operations"."source_revision", 0) BETWEEN 0 AND '9007199254740991'::bigint
        AND COALESCE("ai_operations"."reviewed_at_epoch_millis", 0) BETWEEN 0 AND '9007199254740991'::bigint
        AND COALESCE("ai_operations"."analysis_sequence", 0) BETWEEN 0 AND '9007199254740991'::bigint
        AND COALESCE("ai_operations"."base_reply_state_revision", 0) BETWEEN 0 AND '9007199254740991'::bigint
        AND COALESCE("ai_operations"."terminal_analysis_sequence", 0) BETWEEN 0 AND '9007199254740991'::bigint
        AND COALESCE("ai_operations"."aggregate_revision", 0) BETWEEN 0 AND '9007199254740991'::bigint
        AND COALESCE("ai_operations"."adopted_reply_revision", 0) BETWEEN 0 AND '9007199254740991'::bigint
        AND COALESCE("ai_operations"."adopted_review_reply_state_revision", 0) BETWEEN 0 AND '9007199254740991'::bigint);
--> statement-breakpoint
CREATE FUNCTION "invalidate_ai_reply_adoption_v1"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  origin_operation_id_value uuid;
  invalidated boolean;
BEGIN
  origin_operation_id_value := OLD."origin_operation_id";
  IF origin_operation_id_value IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  invalidated := TG_OP = 'DELETE';
  IF TG_OP = 'UPDATE' THEN
    invalidated :=
      NEW."text" IS DISTINCT FROM OLD."text"
      OR NEW."authorship" IS DISTINCT FROM OLD."authorship"
      OR NEW."origin_operation_id" IS DISTINCT FROM OLD."origin_operation_id"
      OR NEW."origin_source_epoch" IS DISTINCT FROM OLD."origin_source_epoch"
      OR NEW."origin_source_revision" IS DISTINCT FROM OLD."origin_source_revision"
      OR NEW."origin_base_reply_state_revision" IS DISTINCT FROM OLD."origin_base_reply_state_revision"
      OR NEW."origin_reply_drafting_epoch" IS DISTINCT FROM OLD."origin_reply_drafting_epoch"
      OR NEW."origin_property_profile_version" IS DISTINCT FROM OLD."origin_property_profile_version"
      OR NEW."origin_ai_profile_version" IS DISTINCT FROM OLD."origin_ai_profile_version"
      OR NEW."origin_reply_template_id" IS DISTINCT FROM OLD."origin_reply_template_id"
      OR NEW."origin_reply_template_catalogue_version" IS DISTINCT FROM OLD."origin_reply_template_catalogue_version"
      OR NEW."origin_reply_template_catalogue_digest" IS DISTINCT FROM OLD."origin_reply_template_catalogue_digest"
      OR NEW."origin_concrete_language_tag" IS DISTINCT FROM OLD."origin_concrete_language_tag"
      OR NEW."origin_template_group" IS DISTINCT FROM OLD."origin_template_group"
      OR NEW."ai_draft_expires_at" IS DISTINCT FROM OLD."ai_draft_expires_at";
  END IF;

  IF invalidated THEN
    UPDATE "ai_operations"
    SET
      "reply_adoption_disposition" = 'invalidated',
      "updated_at" = transaction_timestamp()
    WHERE "id" = origin_operation_id_value
      AND "command" = 'reply'
      AND "reply_adoption_disposition" = 'adopted';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "replies_invalidate_ai_adoption"
AFTER UPDATE OR DELETE ON "replies"
FOR EACH ROW
EXECUTE FUNCTION "invalidate_ai_reply_adoption_v1"();