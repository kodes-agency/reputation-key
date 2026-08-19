CREATE TYPE "public"."reply_authorship" AS ENUM('human', 'ai_assisted');--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "authorship" "reply_authorship";--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "origin_operation_id" uuid;--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "origin_source_epoch" integer;--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "origin_source_revision" bigint;--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "origin_base_reply_state_revision" bigint;--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "origin_reply_drafting_epoch" integer;--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "origin_property_profile_version" integer;--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "origin_ai_profile_version" varchar(100);--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "origin_reply_template_id" varchar(64);--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "origin_reply_template_catalogue_version" varchar(100);--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "origin_reply_template_catalogue_digest" varchar(64);--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "origin_concrete_language_tag" varchar(35);--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "origin_template_group" varchar(35);--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "ai_draft_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "reply_state_revision" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "reviews" AS review
SET "reply_state_revision" = 1
WHERE EXISTS (
  SELECT 1
  FROM "replies" AS reply
  WHERE reply."review_id" = review."id"
    AND reply."organization_id" = review."organization_id"
    AND reply."source" = 'internal'
);--> statement-breakpoint
UPDATE "replies"
SET "authorship" = CASE
  WHEN "source" = 'internal' AND "ai_generated" THEN 'ai_assisted'::"reply_authorship"
  WHEN "source" = 'internal' THEN 'human'::"reply_authorship"
  ELSE NULL
END;--> statement-breakpoint
CREATE FUNCTION "advance_review_reply_state_revision_v1"(
  p_review_id uuid,
  p_organization_id varchar
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  changed_rows integer;
BEGIN
  UPDATE "reviews"
  SET "reply_state_revision" = "reply_state_revision" + 1
  WHERE "id" = p_review_id
    AND "organization_id" = p_organization_id
    AND "reply_state_revision" < '9007199254740991'::bigint;

  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 1 THEN
    RAISE EXCEPTION 'cannot advance review reply state revision';
  END IF;
END;
$$;--> statement-breakpoint
CREATE FUNCTION "protect_review_reply_state_revision_v1"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."reply_state_revision" IS DISTINCT FROM OLD."reply_state_revision"
    AND (
      pg_trigger_depth() < 2
      OR NEW."reply_state_revision" <> OLD."reply_state_revision" + 1
    )
  THEN
    RAISE EXCEPTION 'review reply state revision is trigger-owned';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "reviews_protect_reply_state_revision"
BEFORE UPDATE OF "reply_state_revision" ON "reviews"
FOR EACH ROW
EXECUTE FUNCTION "protect_review_reply_state_revision_v1"();--> statement-breakpoint
DROP TRIGGER "replies_increment_state_revision" ON "replies";--> statement-breakpoint
CREATE OR REPLACE FUNCTION "increment_reply_state_revision"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  material_change boolean;
  authorship_changed boolean;
  legacy_changed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."source" = 'google_sync' THEN
      IF NEW."authorship" IS NOT NULL OR NEW."ai_generated" THEN
        RAISE EXCEPTION 'Google reply mirrors cannot claim authorship';
      END IF;
      NEW."authorship" := NULL;
      NEW."ai_generated" := false;
    ELSE
      IF NEW."authorship" IS NULL THEN
        NEW."authorship" := CASE
          WHEN NEW."ai_generated" THEN 'ai_assisted'::"reply_authorship"
          ELSE 'human'::"reply_authorship"
        END;
      ELSE
        NEW."ai_generated" := NEW."authorship" = 'ai_assisted';
      END IF;
      IF NEW."state_revision" <> 1 THEN
        RAISE EXCEPTION 'new Reply state revision must be 1';
      END IF;
      PERFORM "advance_review_reply_state_revision_v1"(
        NEW."review_id",
        NEW."organization_id"
      );
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."review_id" IS DISTINCT FROM OLD."review_id"
    OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
    OR NEW."source" IS DISTINCT FROM OLD."source"
  THEN
    RAISE EXCEPTION 'Reply ownership and source are immutable';
  END IF;

  IF NEW."source" = 'google_sync' THEN
    IF NEW."authorship" IS NOT NULL OR NEW."ai_generated" THEN
      RAISE EXCEPTION 'Google reply mirrors cannot claim authorship';
    END IF;
    NEW."authorship" := NULL;
    NEW."ai_generated" := false;
  ELSE
    authorship_changed := NEW."authorship" IS DISTINCT FROM OLD."authorship";
    legacy_changed := NEW."ai_generated" IS DISTINCT FROM OLD."ai_generated";

    IF authorship_changed AND legacy_changed THEN
      IF NEW."authorship" IS NULL
        OR NEW."ai_generated" IS DISTINCT FROM
          (NEW."authorship" = 'ai_assisted')
      THEN
        RAISE EXCEPTION 'contradictory Reply authorship fields';
      END IF;
    ELSIF authorship_changed THEN
      IF NEW."authorship" IS NULL THEN
        RAISE EXCEPTION 'internal Reply authorship is required';
      END IF;
      NEW."ai_generated" := NEW."authorship" = 'ai_assisted';
    ELSIF legacy_changed THEN
      NEW."authorship" := CASE
        WHEN NEW."ai_generated" THEN 'ai_assisted'::"reply_authorship"
        ELSE 'human'::"reply_authorship"
      END;
    END IF;

    IF NEW."authorship" IS NULL THEN
      RAISE EXCEPTION 'internal Reply authorship is required';
    END IF;
  END IF;

  IF NEW."authorship" IS DISTINCT FROM 'ai_assisted'::"reply_authorship" THEN
    NEW."origin_operation_id" := NULL;
    NEW."origin_source_epoch" := NULL;
    NEW."origin_source_revision" := NULL;
    NEW."origin_base_reply_state_revision" := NULL;
    NEW."origin_reply_drafting_epoch" := NULL;
    NEW."origin_property_profile_version" := NULL;
    NEW."origin_ai_profile_version" := NULL;
    NEW."origin_reply_template_id" := NULL;
    NEW."origin_reply_template_catalogue_version" := NULL;
    NEW."origin_reply_template_catalogue_digest" := NULL;
    NEW."origin_concrete_language_tag" := NULL;
    NEW."origin_template_group" := NULL;
    NEW."ai_draft_expires_at" := NULL;
  END IF;

  material_change := NEW."source" = 'internal' AND (
    NEW."text" IS DISTINCT FROM OLD."text"
    OR NEW."status" IS DISTINCT FROM OLD."status"
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
    OR NEW."ai_draft_expires_at" IS DISTINCT FROM OLD."ai_draft_expires_at"
  );

  IF material_change THEN
    IF NEW."state_revision" = OLD."state_revision" THEN
      NEW."state_revision" := OLD."state_revision" + 1;
    ELSIF NEW."state_revision" <> OLD."state_revision" + 1 THEN
      RAISE EXCEPTION 'invalid Reply state revision transition';
    END IF;
    PERFORM "advance_review_reply_state_revision_v1"(
      NEW."review_id",
      NEW."organization_id"
    );
  ELSIF NEW."state_revision" IS DISTINCT FROM OLD."state_revision" THEN
    RAISE EXCEPTION 'Reply state revision changed without a material transition';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "replies_increment_state_revision"
BEFORE INSERT OR UPDATE ON "replies"
FOR EACH ROW
EXECUTE FUNCTION "increment_reply_state_revision"();--> statement-breakpoint
CREATE FUNCTION "advance_review_reply_state_revision_on_delete_v1"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."source" = 'internal' AND EXISTS (
    SELECT 1
    FROM "reviews"
    WHERE "id" = OLD."review_id"
      AND "organization_id" = OLD."organization_id"
  ) THEN
    PERFORM "advance_review_reply_state_revision_v1"(
      OLD."review_id",
      OLD."organization_id"
    );
  END IF;
  RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "replies_advance_state_revision_on_delete"
BEFORE DELETE ON "replies"
FOR EACH ROW
EXECUTE FUNCTION "advance_review_reply_state_revision_on_delete_v1"();--> statement-breakpoint
CREATE UNIQUE INDEX "replies_origin_operation_unique" ON "replies" USING btree ("origin_operation_id") WHERE origin_operation_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_authorship_valid" CHECK ((
        ("replies"."source" = 'google_sync' AND "replies"."authorship" IS NULL AND "replies"."ai_generated" = false)
        OR (
          "replies"."source" = 'internal'
          AND "replies"."authorship" IS NOT NULL
          AND (
            ("replies"."ai_generated" = false AND "replies"."authorship" = 'human')
            OR ("replies"."ai_generated" = true AND "replies"."authorship" = 'ai_assisted')
          )
        )
      ));--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_ai_provenance_valid" CHECK ((
        (
          "replies"."authorship" = 'ai_assisted'
          AND "replies"."origin_operation_id" IS NOT NULL
          AND "replies"."origin_source_epoch" >= 1
          AND "replies"."origin_source_revision" >= 1
          AND "replies"."origin_base_reply_state_revision" BETWEEN 0 AND '9007199254740991'::bigint
          AND "replies"."origin_reply_drafting_epoch" >= 1
          AND "replies"."origin_property_profile_version" >= 1
          AND "replies"."origin_ai_profile_version" = 'reply-suggestion-v1'
          AND "replies"."origin_reply_template_id" IN (
            'appreciation_positive',
            'appreciation_neutral',
            'recovery_service',
            'acknowledge_concern'
          )
          AND "replies"."origin_reply_template_catalogue_version" = 'gbp-reply-template-catalogue-v1'
          AND "replies"."origin_reply_template_catalogue_digest" = 'dc0e767cfe8aa4694e2b37870e1f9510fe1b56ed4eea0ed91af4655ea3404f33'
          AND "replies"."origin_template_group" IN (
            'en-Latn', 'es-Latn', 'fr-Latn', 'de-Latn', 'pt-Latn',
            'it-Latn', 'nl-Latn', 'pl-Latn', 'tr-Latn', 'uk-Cyrl',
            'ru-Cyrl', 'ar-Arab', 'he-Hebr', 'hi-Deva', 'bn-Beng',
            'ta-Taml', 'th-Thai', 'vi-Latn', 'id-Latn', 'zh-Hans',
            'zh-Hant', 'ja-Jpan', 'ko-Kore'
          )
          AND (
            "replies"."origin_concrete_language_tag" = "replies"."origin_template_group"
            OR "replies"."origin_concrete_language_tag" LIKE "replies"."origin_template_group" || '-%'
          )
          AND "replies"."ai_draft_expires_at" IS NOT NULL
        )
        OR (
          "replies"."origin_operation_id" IS NULL
          AND "replies"."origin_source_epoch" IS NULL
          AND "replies"."origin_source_revision" IS NULL
          AND "replies"."origin_base_reply_state_revision" IS NULL
          AND "replies"."origin_reply_drafting_epoch" IS NULL
          AND "replies"."origin_property_profile_version" IS NULL
          AND "replies"."origin_ai_profile_version" IS NULL
          AND "replies"."origin_reply_template_id" IS NULL
          AND "replies"."origin_reply_template_catalogue_version" IS NULL
          AND "replies"."origin_reply_template_catalogue_digest" IS NULL
          AND "replies"."origin_concrete_language_tag" IS NULL
          AND "replies"."origin_template_group" IS NULL
          AND "replies"."ai_draft_expires_at" IS NULL
        )
      ));--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reply_state_revision_safe" CHECK ("reviews"."reply_state_revision" BETWEEN 0 AND '9007199254740991'::bigint);