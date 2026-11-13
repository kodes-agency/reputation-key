-- migrate:contract 27dbea6e2e49e5f3af8f48eb299d9cd78d7f5a69
-- Drops the legacy guest ratings and feedback tables. Nothing reads or writes
-- them any more; guest responses live in the guest_responses tables. The guard
-- refuses to run while either table holds a row, so a surprise row is reported
-- rather than deleted. feedback goes first: its rating_id references ratings.
DO $guard$
DECLARE
  v_ratings bigint;
  v_feedback bigint;
BEGIN
  IF to_regclass('public.ratings') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.ratings' INTO v_ratings;
  ELSE
    v_ratings := 0;
  END IF;
  IF to_regclass('public.feedback') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.feedback' INTO v_feedback;
  ELSE
    v_feedback := 0;
  END IF;
  IF v_ratings > 0 OR v_feedback > 0 THEN
    RAISE EXCEPTION 'Cannot drop the legacy guest tables: ratings holds % rows and feedback holds % rows', v_ratings, v_feedback;
  END IF;
END;
$guard$;
--> statement-breakpoint
DROP TABLE "feedback";--> statement-breakpoint
DROP TABLE "ratings";
