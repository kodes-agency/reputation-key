-- migrate:contract 61db09a2ca671c23ea2cfdb4dbc604e13d92d254
-- Keep writers out between the provenance counts and the column drops.
LOCK TABLE public.replies IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
DO $guard$
DECLARE
  v_template_id_count bigint;
  v_template_version_count bigint;
BEGIN
  SELECT count(*) FILTER (WHERE template_id IS NOT NULL),
    count(*) FILTER (WHERE template_version IS NOT NULL)
  INTO v_template_id_count, v_template_version_count
  FROM public.replies;
  IF v_template_id_count > 0 OR v_template_version_count > 0 THEN
    RAISE EXCEPTION 'Cannot drop replies.template_id (% non-null rows) or replies.template_version (% non-null rows)',
      v_template_id_count, v_template_version_count;
  END IF;
END;
$guard$;
--> statement-breakpoint
ALTER TABLE public.replies
  DROP CONSTRAINT replies_template_provenance_valid,
  DROP COLUMN template_id,
  DROP COLUMN template_version;
