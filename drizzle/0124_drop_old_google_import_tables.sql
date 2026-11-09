-- migrate:contract 556b03515febb43440b1d55c24065b9da655736b
-- Block writers between the activity checks and the drops.
LOCK TABLE public.gbp_import_request_items,
  public.gbp_import_requests,
  public.gbp_import_sagas IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
DO $guard$
DECLARE
  v_count bigint;
BEGIN
  SELECT count(*) INTO v_count FROM public.gbp_import_request_items
    WHERE status IN ('pending', 'processing');
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Cannot drop gbp_import_request_items: % rows are pending or processing', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.gbp_import_requests
    WHERE status IN ('queued', 'processing');
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Cannot drop gbp_import_requests: % rows are queued or processing', v_count;
  END IF;
END;
$guard$;
--> statement-breakpoint
DROP TABLE public.gbp_import_request_items;
--> statement-breakpoint
DROP TABLE public.gbp_import_requests;
--> statement-breakpoint
DROP TABLE public.gbp_import_sagas;
--> statement-breakpoint
DROP TYPE public.google_import_v2_parent_status;
