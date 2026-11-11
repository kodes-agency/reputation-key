-- migrate:contract c17b420cc733ac92718fe85fbfd45913d9bf190c
-- Block writers between the row check and the drop.
LOCK TABLE
  public.ai_property_trend_scheduler_heads,
  public.ai_property_trend_schedules,
  public.ai_property_trend_outcomes,
  public.ai_property_daily_aggregates,
  public.ai_property_daily_aspect_aggregates,
  public.ai_property_aggregate_contribution_aspects,
  public.ai_review_analysis_aspects,
  public.ai_property_review_population_daily
  IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
DO $guard$
DECLARE
  v_table text;
  v_count bigint;
BEGIN
  -- The baseline seeds one scheduler head; anything beyond it is data.
  SELECT count(*) INTO v_count FROM public.ai_property_trend_scheduler_heads;
  IF v_count > 1 THEN
    RAISE EXCEPTION 'Cannot drop ai_property_trend_scheduler_heads: % rows remain', v_count;
  END IF;
  FOREACH v_table IN ARRAY ARRAY[
    'ai_property_trend_schedules',
    'ai_property_trend_outcomes',
    'ai_property_daily_aggregates',
    'ai_property_daily_aspect_aggregates',
    'ai_property_aggregate_contribution_aspects',
    'ai_review_analysis_aspects',
    'ai_property_review_population_daily'
  ] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', v_table) INTO v_count;
    IF v_count > 0 THEN
      RAISE EXCEPTION 'Cannot drop %: % rows remain', v_table, v_count;
    END IF;
  END LOOP;
END;
$guard$;
--> statement-breakpoint
DROP TABLE
  public.ai_property_trend_outcomes,
  public.ai_property_trend_schedules,
  public.ai_property_trend_scheduler_heads,
  public.ai_property_daily_aspect_aggregates,
  public.ai_property_daily_aggregates,
  public.ai_property_aggregate_contribution_aspects,
  public.ai_review_analysis_aspects,
  public.ai_property_review_population_daily;
