-- migrate:contract 4a8db95d5c7b6e7e9771c0e72a5caadd39dac839
-- Block writers between the content check and the drops.
LOCK TABLE public.reviews IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
DO $guard$
DECLARE
  v_missing bigint;
BEGIN
  SELECT count(*) INTO v_missing
  FROM public.reviews AS review
  WHERE review.source_content_state = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM public.review_source_contents AS content
      WHERE content.review_id = review.id
    );
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'Cannot drop the Review content copy: % active Reviews have no review_source_contents row', v_missing;
  END IF;
END;
$guard$;
--> statement-breakpoint
ALTER TABLE public.reviews
  DROP CONSTRAINT reviews_source_content_state_valid,
  DROP CONSTRAINT reviews_ai_source_byte_length_valid,
  DROP CONSTRAINT reviews_ai_source_digest_valid,
  DROP COLUMN reviewer_name,
  DROP COLUMN reviewer_profile_photo_url,
  DROP COLUMN google_review_url,
  DROP COLUMN rating,
  DROP COLUMN text,
  DROP COLUMN translated_text,
  DROP COLUMN language_code,
  DROP COLUMN reviewed_at,
  DROP COLUMN source_created_at,
  DROP COLUMN source_updated_at,
  DROP COLUMN last_fetched_at,
  DROP COLUMN content_expires_at,
  DROP COLUMN content_hash,
  DROP COLUMN ai_source_byte_length,
  DROP COLUMN ai_source_digest;
--> statement-breakpoint
ALTER TABLE public.reviews
  ADD CONSTRAINT reviews_source_content_state_valid CHECK (
    (source_content_state = 'active' AND source_content_erased_at IS NULL)
    OR (
      source_content_state IN ('source_expired', 'provider_deleted')
      AND source_content_erased_at IS NOT NULL
      AND external_id IS NULL
      AND external_location_id IS NULL
      AND google_connection_id IS NULL
    )
  ) NOT VALID;
