-- migrate:contract 7a6f1f7a7352bc0765d18a1adf08e55e14ceae60
-- Block writers between the checks and the drops.
LOCK TABLE public.metric_readings,
  public.setup_checklist_milestones,
  public.portal_metric_lifetime_aggregates IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
DO $guard$
DECLARE
  v_count bigint;
BEGIN
  SELECT count(*) INTO v_count FROM public.metric_readings
    WHERE metric_key = 'property.review';
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Cannot retire property.review: metric_readings still holds % rows', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.setup_checklist_milestones;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Cannot drop setup_checklist_milestones: % rows remain', v_count;
  END IF;
END;
$guard$;
--> statement-breakpoint
DROP TABLE public.setup_checklist_milestones;
--> statement-breakpoint
DROP TABLE public.portal_metric_lifetime_aggregates;
