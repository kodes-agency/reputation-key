-- The Review source fence stops blocking foreign-key checks (2026-09-29,
-- closed-beta-v2).
--
-- Every review import, Inbox projection and AI sequence allocation locks its
-- Property row to fence `source_epoch`. This function took it `FOR UPDATE`, a
-- mode that also conflicts with the `FOR KEY SHARE` lock a foreign-key check
-- takes on the referenced row. During a 244-review import the fence was held
-- almost continuously, so inserts into `metric_readings`,
-- `ai_property_aggregate_settlements` and `notifications` for that Property
-- queued behind it and failed at the 10 s lock timeout.
--
-- The fence is only read here, never updated, so it is taken
-- `FOR NO KEY UPDATE`. That mode still conflicts with itself, with
-- `FOR UPDATE` and with `UPDATE properties`, so fence holders and epoch writers
-- exclude each other exactly as before. Only foreign-key checks stop waiting.
-- The application-side fence (`lockReviewSourceMutationScope`) switches in the
-- same release, so the two keep taking the same mode.
--
-- The whole function is restated because PL/pgSQL has no partial replace. It is
-- identical to src/shared/db/db-constructs.sql, which carries the same change so
-- a fresh database built from the baseline agrees with an upgraded one.
CREATE OR REPLACE FUNCTION public.lock_review_ai_analysis_head_v1(p_organization_id text, p_property_id uuid, p_source_epoch integer)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  property_epoch integer;
  next_sequence bigint;
BEGIN
  SELECT "source_epoch" INTO property_epoch
  FROM public."properties"
  WHERE "organization_id" = p_organization_id
    AND "id" = p_property_id
  FOR NO KEY UPDATE;

  IF property_epoch IS NULL OR property_epoch <> p_source_epoch THEN
    RAISE EXCEPTION 'review_source_epoch_changed' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public."review_ai_analysis_heads" (
    "organization_id", "property_id", "source_epoch", "head_sequence"
  )
  VALUES (p_organization_id, p_property_id, p_source_epoch, 0)
  ON CONFLICT DO NOTHING;

  UPDATE public."review_ai_analysis_heads"
  SET "head_sequence" = "head_sequence" + 1,
      "updated_at" = transaction_timestamp()
  WHERE "organization_id" = p_organization_id
    AND "property_id" = p_property_id
    AND "source_epoch" = p_source_epoch
    AND "head_sequence" < 9007199254740991
  RETURNING "head_sequence" INTO next_sequence;

  IF next_sequence IS NULL THEN
    RAISE EXCEPTION 'review_analysis_sequence_unavailable' USING ERRCODE = '22003';
  END IF;
  RETURN next_sequence;
END;
$function$
;
