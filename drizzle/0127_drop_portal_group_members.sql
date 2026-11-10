-- migrate:contract 24aae53d7d5d96b0e0c12a036f70211eb34c518a
-- Block writers between the row check and the drop.
LOCK TABLE public.portal_group_members IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
DO $guard$
DECLARE
  v_count bigint;
BEGIN
  SELECT count(*) INTO v_count FROM public.portal_group_members;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Cannot drop portal_group_members: % rows remain', v_count;
  END IF;
END;
$guard$;
--> statement-breakpoint
DROP TABLE public.portal_group_members;
