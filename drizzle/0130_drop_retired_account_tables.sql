-- migrate:contract 6125e76d91e831752da10a77b01a03b9d61f635d
-- Block writers between the row checks and the drops.
LOCK TABLE public."organizationRole",
  public.organization_role_policy,
  public.property_access_grants,
  public.policy_consent,
  public.property_erase_authorities,
  public.privacy_requests,
  public.organization_lifecycle_authority,
  public.organization_exports,
  public.organization_export_retrieval_issuances IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
DO $guard$
DECLARE
  v_table text;
  v_count bigint;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'organizationRole',
    'organization_role_policy',
    'property_access_grants',
    'policy_consent',
    'property_erase_authorities',
    'privacy_requests',
    'organization_exports',
    'organization_export_retrieval_issuances'
  ] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', v_table) INTO v_count;
    IF v_count > 0 THEN
      RAISE EXCEPTION 'Cannot drop %: it holds % rows', v_table, v_count;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_count FROM public.organization_lifecycle_authority
    WHERE state IS DISTINCT FROM 'active' OR closed_at IS NOT NULL;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Cannot drop organization_lifecycle_authority: % rows are not active with closed_at null', v_count;
  END IF;
END;
$guard$;
--> statement-breakpoint
DROP TRIGGER organization_lifecycle_authority_provision ON public.organization;
--> statement-breakpoint
DROP TABLE public.organization_export_retrieval_issuances;
--> statement-breakpoint
DROP TABLE public.organization_exports;
--> statement-breakpoint
DROP TABLE public.organization_lifecycle_authority;
--> statement-breakpoint
DROP TABLE public.privacy_requests;
--> statement-breakpoint
DROP TABLE public.property_erase_authorities;
--> statement-breakpoint
DROP TABLE public.policy_consent;
--> statement-breakpoint
DROP TABLE public.property_access_grants;
--> statement-breakpoint
DROP TABLE public.organization_role_policy;
--> statement-breakpoint
DROP TABLE public."organizationRole";
--> statement-breakpoint
DROP FUNCTION public.provision_organization_lifecycle_authority_v1();
--> statement-breakpoint
DROP FUNCTION public.guard_organization_lifecycle_revision_v1();
--> statement-breakpoint
DROP FUNCTION public.guard_organization_export_revision_v1();
--> statement-breakpoint
DROP FUNCTION public.guard_organization_export_retrieval_issuance_v1();
--> statement-breakpoint
DROP FUNCTION public.verify_organization_export_retrieval_issuance_v1();
--> statement-breakpoint
DROP FUNCTION public.reject_identity_lifecycle_evidence_mutation_v1();
--> statement-breakpoint
DROP FUNCTION public.reject_privacy_request_mutation_v1();
--> statement-breakpoint
DROP FUNCTION public.reject_property_erase_authority_mutation_v1();
--> statement-breakpoint
DROP TYPE public.grant_status;
--> statement-breakpoint
DROP TYPE public.grant_kind;
