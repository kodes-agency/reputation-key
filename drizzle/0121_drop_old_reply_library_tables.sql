-- migrate:contract 5598fa7ef8d0ef2df0f275361bb31b8fa3583cae
-- Block writers between the row counts and the drops.
LOCK TABLE public.property_reply_templates,
  public.property_reply_profiles IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
DO $guard$
DECLARE
  v_count bigint;
BEGIN
  SELECT count(*) INTO v_count FROM public.property_reply_templates;
  IF v_count > 1 THEN
    RAISE EXCEPTION 'Cannot drop property_reply_templates: table holds % rows', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.property_reply_profiles;
  IF v_count > 1 THEN
    RAISE EXCEPTION 'Cannot drop property_reply_profiles: table holds % rows', v_count;
  END IF;
END;
$guard$;
--> statement-breakpoint
DROP TABLE public.property_reply_templates;
--> statement-breakpoint
DROP TABLE public.property_reply_profiles;
