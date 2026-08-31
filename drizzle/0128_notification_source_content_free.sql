-- Notification is a durable delivery context, not a second Review cache.
-- Keep locally collected Portal ratings while removing every legacy/provider
-- review-rating copy from payloads and rendered fallback snapshots.
CREATE OR REPLACE FUNCTION public.normalize_notification_source_content_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_is_portal boolean;
  v_legacy_rating jsonb;
  v_guest_rating_valid boolean;
BEGIN
  NEW.payload := COALESCE(NEW.payload, '{}'::jsonb);
  v_is_portal := COALESCE(NEW.payload->>'platform' = 'portal', false);

  IF NEW.payload ? 'rating' THEN
    v_legacy_rating := NEW.payload->'rating';
    NEW.payload := NEW.payload - 'rating';
    IF v_is_portal
      AND jsonb_typeof(v_legacy_rating) = 'number'
      AND v_legacy_rating#>>'{}' IN ('1', '2', '3', '4', '5')
    THEN
      NEW.payload := jsonb_set(
        NEW.payload,
        '{guestRating}',
        v_legacy_rating,
        true
      );
    ELSE
      NEW.title := regexp_replace(
        NEW.title,
        '[1-5]-star[[:space:]]+',
        '',
        'g'
      );
      NEW.body := regexp_replace(
        NEW.body,
        '[1-5]-star[[:space:]]+',
        '',
        'g'
      );
      IF NEW.type = 'review.created' THEN
        NEW.body := 'Open it to read the review and reply.';
      END IF;
    END IF;
  END IF;

  v_guest_rating_valid :=
    v_is_portal
    AND NEW.payload ? 'guestRating'
    AND jsonb_typeof(NEW.payload->'guestRating') = 'number'
    AND NEW.payload->>'guestRating' IN ('1', '2', '3', '4', '5');
  IF NEW.payload ? 'guestRating' AND NOT v_guest_rating_valid THEN
    NEW.payload := NEW.payload - 'guestRating';
    NEW.title := regexp_replace(
      NEW.title,
      '[1-5]-star[[:space:]]+',
      '',
      'g'
    );
    NEW.body := regexp_replace(
      NEW.body,
      '[1-5]-star[[:space:]]+',
      '',
      'g'
    );
    IF NEW.type = 'review.created' THEN
      NEW.body := 'Open it to read the review and reply.';
    END IF;
  END IF;

  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER "notifications_normalize_source_content"
BEFORE INSERT OR UPDATE OF "payload", "title", "body", "type" ON "notifications"
FOR EACH ROW
EXECUTE FUNCTION public.normalize_notification_source_content_v1();--> statement-breakpoint

-- Re-run every row that can carry the old or malformed key through the same
-- compatibility normalizer used for rolling-deployment writes.
UPDATE "notifications"
SET
  "payload" = "payload",
  "title" = "title",
  "body" = "body"
WHERE COALESCE("payload", '{}'::jsonb) ?| ARRAY['rating', 'guestRating'];--> statement-breakpoint

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_source_content_free_check"
  CHECK (
    NOT (COALESCE("payload", '{}'::jsonb) ? 'rating')
    AND CASE
      WHEN COALESCE("payload", '{}'::jsonb) ? 'guestRating' THEN
        COALESCE(
          "payload"->>'platform' = 'portal'
          AND jsonb_typeof("payload"->'guestRating') = 'number'
          AND "payload"->>'guestRating' = ANY (
            ARRAY['1', '2', '3', '4', '5']::text[]
          ),
          false
        )
      ELSE true
    END
  ) NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications"
  VALIDATE CONSTRAINT "notifications_source_content_free_check";
