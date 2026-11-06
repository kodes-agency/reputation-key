-- migrate:contract dc00ff7df760fe559cbdf1d94660c85662d6698b
-- Preflight requires the release that removed exact-count readiness readers on
-- both web and worker before replacing CHECKs and the notice ancestry function.
-- Expand notice evidence without rewriting grants or historical consent.
--> statement-breakpoint
ALTER TABLE "merchant_ai_consent_evidence" DROP CONSTRAINT "merchant_ai_consent_evidence_contract_valid";
--> statement-breakpoint
ALTER TABLE "merchant_ai_consent_evidence" ADD CONSTRAINT "merchant_ai_consent_evidence_contract_valid" CHECK ((
          ("merchant_ai_consent_evidence"."notice_version"::text = 'merchant-ai-notice-2026-08-15.v1'::text
            AND "merchant_ai_consent_evidence"."notice_digest"::text = '4ae20219b3ba1ae575ccd567ec88f20201c0c47289606c614ac0bead2c3edc6b'::text)
          OR ("merchant_ai_consent_evidence"."notice_version"::text = 'merchant-ai-notice-2026-08-19.v1'::text
            AND "merchant_ai_consent_evidence"."notice_digest"::text = 'f0d809baa42995be174a536561a56f4c6656e9b1a60feb5773466f2d1eb2bf31'::text)
          OR ("merchant_ai_consent_evidence"."notice_version"::text = 'merchant-ai-notice-2026-09-06.v1'::text
            AND "merchant_ai_consent_evidence"."notice_digest"::text = '7bb8d9bddbec630d90f546ba4d0f308076840e25786389a19e1c651dd21434a8'::text)
          OR ("merchant_ai_consent_evidence"."notice_version"::text = 'merchant-ai-notice-2026-09-08.v1'::text
            AND "merchant_ai_consent_evidence"."notice_digest"::text = 'c24030bc98918d3fa6a8e820bf6bca6489a4c8835cf61bd12ab6b84a8f0a0865'::text)
          OR ("merchant_ai_consent_evidence"."notice_version"::text = 'merchant-ai-notice-2026-09-09.v1'::text
            AND "merchant_ai_consent_evidence"."notice_digest"::text = 'd80fe3b03f89697cde6c46810053248206aa3745b5f4a5522a24c1c2fdb438e1'::text)
          OR ("merchant_ai_consent_evidence"."notice_version"::text = 'merchant-ai-notice-2026-09-15.v1'::text
            AND "merchant_ai_consent_evidence"."notice_digest"::text = '6c98ae3bb57b5b142afed1749a1b9f59be8d6ca7edaca3250e39055897289a9c'::text)
          OR ("merchant_ai_consent_evidence"."notice_version"::text = 'merchant-ai-notice-2026-10-17.v1'::text
            AND "merchant_ai_consent_evidence"."notice_digest"::text = '2bcd2be15cbb81f324f9a9390ad00baff3ffbb25a6c0db8bff71fbb2b1b0975e'::text)
          OR ("merchant_ai_consent_evidence"."notice_version"::text = 'merchant-ai-notice-2026-10-30.v1'::text
            AND "merchant_ai_consent_evidence"."notice_digest"::text = 'dadad7b81dbda360678fc57f7265b104c7311cbc213f877f32306c53b4852a5e'::text)
          OR ("merchant_ai_consent_evidence"."notice_version"::text = 'merchant-ai-notice-2026-11-01.v1'::text
            AND "merchant_ai_consent_evidence"."notice_digest"::text = 'e9574380fd1ba5f4b7bd7b9899bc5e6bdf371f9d9871584f33c5c1e6131290ef'::text)
          OR ("merchant_ai_consent_evidence"."notice_version"::text = 'merchant-ai-notice-2026-11-06.v1'::text
            AND "merchant_ai_consent_evidence"."notice_digest"::text = '0bc68a446ee42ed76a15575ad44b090480742a3187184a8a19157dd0492e14d9'::text)
        )
        AND "merchant_ai_consent_evidence"."source_policy_id"::text = 'google-business-profile-source-policy-v1'::text
        AND "merchant_ai_consent_evidence"."routing_policy_version" = 1::integer
        AND "merchant_ai_consent_evidence"."redaction_profile_family"::text = 'gbp-review-global-v1'::text) NOT VALID;
--> statement-breakpoint
ALTER TABLE "merchant_ai_enablement" DROP CONSTRAINT "merchant_ai_enablement_contract_valid";
--> statement-breakpoint
ALTER TABLE "merchant_ai_enablement" ADD CONSTRAINT "merchant_ai_enablement_contract_valid" CHECK ((
          ("merchant_ai_enablement"."notice_version"::text = 'merchant-ai-notice-2026-08-15.v1'::text
            AND "merchant_ai_enablement"."notice_digest"::text = '4ae20219b3ba1ae575ccd567ec88f20201c0c47289606c614ac0bead2c3edc6b'::text)
          OR ("merchant_ai_enablement"."notice_version"::text = 'merchant-ai-notice-2026-08-19.v1'::text
            AND "merchant_ai_enablement"."notice_digest"::text = 'f0d809baa42995be174a536561a56f4c6656e9b1a60feb5773466f2d1eb2bf31'::text)
          OR ("merchant_ai_enablement"."notice_version"::text = 'merchant-ai-notice-2026-09-06.v1'::text
            AND "merchant_ai_enablement"."notice_digest"::text = '7bb8d9bddbec630d90f546ba4d0f308076840e25786389a19e1c651dd21434a8'::text)
          OR ("merchant_ai_enablement"."notice_version"::text = 'merchant-ai-notice-2026-09-08.v1'::text
            AND "merchant_ai_enablement"."notice_digest"::text = 'c24030bc98918d3fa6a8e820bf6bca6489a4c8835cf61bd12ab6b84a8f0a0865'::text)
          OR ("merchant_ai_enablement"."notice_version"::text = 'merchant-ai-notice-2026-09-09.v1'::text
            AND "merchant_ai_enablement"."notice_digest"::text = 'd80fe3b03f89697cde6c46810053248206aa3745b5f4a5522a24c1c2fdb438e1'::text)
          OR ("merchant_ai_enablement"."notice_version"::text = 'merchant-ai-notice-2026-09-15.v1'::text
            AND "merchant_ai_enablement"."notice_digest"::text = '6c98ae3bb57b5b142afed1749a1b9f59be8d6ca7edaca3250e39055897289a9c'::text)
          OR ("merchant_ai_enablement"."notice_version"::text = 'merchant-ai-notice-2026-10-17.v1'::text
            AND "merchant_ai_enablement"."notice_digest"::text = '2bcd2be15cbb81f324f9a9390ad00baff3ffbb25a6c0db8bff71fbb2b1b0975e'::text)
          OR ("merchant_ai_enablement"."notice_version"::text = 'merchant-ai-notice-2026-10-30.v1'::text
            AND "merchant_ai_enablement"."notice_digest"::text = 'dadad7b81dbda360678fc57f7265b104c7311cbc213f877f32306c53b4852a5e'::text)
          OR ("merchant_ai_enablement"."notice_version"::text = 'merchant-ai-notice-2026-11-01.v1'::text
            AND "merchant_ai_enablement"."notice_digest"::text = 'e9574380fd1ba5f4b7bd7b9899bc5e6bdf371f9d9871584f33c5c1e6131290ef'::text)
          OR ("merchant_ai_enablement"."notice_version"::text = 'merchant-ai-notice-2026-11-06.v1'::text
            AND "merchant_ai_enablement"."notice_digest"::text = '0bc68a446ee42ed76a15575ad44b090480742a3187184a8a19157dd0492e14d9'::text)
        )
        AND "merchant_ai_enablement"."source_policy_id"::text = 'google-business-profile-source-policy-v1'::text
        AND "merchant_ai_enablement"."routing_policy_version" = 1::integer
        AND "merchant_ai_enablement"."redaction_profile_family"::text = 'gbp-review-global-v1'::text) NOT VALID;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.merchant_ai_notice_material_changes_v1(p_previous_version character varying, p_previous_digest character varying, p_next_version character varying, p_next_digest character varying)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
DECLARE
  cursor_version character varying := p_next_version;
  cursor_digest character varying := p_next_digest;
  prior_version character varying;
  prior_digest character varying;
  changed text[];
  affected text[] := ARRAY[]::text[];
  seen text[] := ARRAY[]::text[];
BEGIN
  WHILE (cursor_version, cursor_digest) IS DISTINCT FROM (p_previous_version, p_previous_digest) LOOP
    IF cursor_version || ':' || cursor_digest = ANY(seen) THEN
      RETURN ARRAY['review_analysis', 'reply_drafting', 'property_trends']::text[];
    END IF;
    seen := array_append(seen, cursor_version || ':' || cursor_digest);
    SELECT replaces_version, replaces_digest, materially_changes
      INTO prior_version, prior_digest, changed
    FROM (VALUES
      ('merchant-ai-notice-2026-11-06.v1', '0bc68a446ee42ed76a15575ad44b090480742a3187184a8a19157dd0492e14d9',
       'merchant-ai-notice-2026-11-01.v1', 'e9574380fd1ba5f4b7bd7b9899bc5e6bdf371f9d9871584f33c5c1e6131290ef',
       ARRAY['review_analysis']::text[]),
      ('merchant-ai-notice-2026-11-01.v1', 'e9574380fd1ba5f4b7bd7b9899bc5e6bdf371f9d9871584f33c5c1e6131290ef',
       'merchant-ai-notice-2026-10-30.v1', 'dadad7b81dbda360678fc57f7265b104c7311cbc213f877f32306c53b4852a5e',
       ARRAY['reply_drafting']::text[]),
      ('merchant-ai-notice-2026-10-30.v1', 'dadad7b81dbda360678fc57f7265b104c7311cbc213f877f32306c53b4852a5e',
       'merchant-ai-notice-2026-10-17.v1', '2bcd2be15cbb81f324f9a9390ad00baff3ffbb25a6c0db8bff71fbb2b1b0975e',
       ARRAY['review_analysis', 'reply_drafting', 'property_trends']::text[]),
      ('merchant-ai-notice-2026-10-17.v1', '2bcd2be15cbb81f324f9a9390ad00baff3ffbb25a6c0db8bff71fbb2b1b0975e',
       'merchant-ai-notice-2026-09-15.v1', '6c98ae3bb57b5b142afed1749a1b9f59be8d6ca7edaca3250e39055897289a9c',
       ARRAY[]::text[])
    ) AS notices(version, digest, replaces_version, replaces_digest, materially_changes)
    WHERE version = cursor_version AND digest = cursor_digest;
    IF NOT FOUND OR prior_version IS NULL OR prior_digest IS NULL THEN
      RETURN ARRAY['review_analysis', 'reply_drafting', 'property_trends']::text[];
    END IF;
    affected := affected || changed;
    cursor_version := prior_version;
    cursor_digest := prior_digest;
  END LOOP;
  RETURN ARRAY(SELECT capability
    FROM unnest(ARRAY['review_analysis', 'reply_drafting', 'property_trends']::text[]) AS capability
    WHERE capability = ANY(affected));
END;
$function$
;
