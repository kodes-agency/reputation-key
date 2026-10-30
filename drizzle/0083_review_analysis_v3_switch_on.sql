-- Review analysis v3 switch-on (slice 3.10, 2026-10-30): the contract the Merchant AI
-- tables may record, and the execution-control plane of the new deployment profile.
--
-- The switch-on serves merchant-ai-notice-2026-10-30.v1 under the provider deployment
-- profile private-beta-global-v2 and the review analysis runtime profile
-- review-analysis-runtime-v2 (src/shared/merchant-ai-notice-contract.ts,
-- ai-provider-deployment-profile.ts, ai-runtime-capability-contract.ts). Consent is
-- recorded under all three, so:
--
-- 1. Both contract CHECKs gain the (version, digest) arm of the new notice. They are
--    append-only OR-chains, so consent recorded under every earlier notice stays
--    valid at its own version; the application holds none of them in force
--    (MERCHANT_AI_NOTICES_IN_FORCE), which is what makes every Property confirm again.
-- 2. The deployment-profile CHECKs admit private-beta-global-v2 beside v1: a head
--    granted under v1 stays a valid row until the owner confirms it again.
-- 3. The runtime-map CHECKs admit review-analysis-runtime-v2 beside v1, in every
--    capability set that holds review analysis.
-- 4. The new deployment profile gets its execution-control plane, enabled and
--    accepting, as the seed gave private-beta-global-v1 (resolveAiExecutionStopFence
--    needs the global, the profile and the capability head; without the profile head
--    every review analysis answers "stopped"). The capability heads are the
--    operator's and are not touched, so nothing runs before an AccountAdmin
--    confirms the notice, and the operator can still stop review analysis, the
--    profile or everything (docs/operations/runbooks.md section 32).
--
-- No row is rewritten and no function changes: apply_merchant_ai_transition_v1 already
-- bumps the capability epochs when the notice, the deployment profile or a runtime
-- profile of an enabled grant changes. Forward only: an earlier image refuses to run
-- against this schema (docs/operations/runbooks.md section 28).

ALTER TABLE "merchant_ai_consent_evidence" DROP CONSTRAINT "merchant_ai_consent_evidence_contract_valid";--> statement-breakpoint
ALTER TABLE "merchant_ai_consent_evidence" DROP CONSTRAINT "merchant_ai_consent_evidence_profile_valid";--> statement-breakpoint
ALTER TABLE "merchant_ai_consent_evidence" DROP CONSTRAINT "merchant_ai_consent_evidence_runtime_map_valid";--> statement-breakpoint
ALTER TABLE "merchant_ai_enablement" DROP CONSTRAINT "merchant_ai_enablement_contract_valid";--> statement-breakpoint
ALTER TABLE "merchant_ai_enablement" DROP CONSTRAINT "merchant_ai_enablement_profile_valid";--> statement-breakpoint
ALTER TABLE "merchant_ai_enablement" DROP CONSTRAINT "merchant_ai_enablement_runtime_map_valid";--> statement-breakpoint
ALTER TABLE "merchant_ai_consent_evidence" ADD CONSTRAINT "merchant_ai_consent_evidence_contract_valid" CHECK ((
          ("merchant_ai_consent_evidence"."notice_version" = 'merchant-ai-notice-2026-08-15.v1'
            AND "merchant_ai_consent_evidence"."notice_digest" = '4ae20219b3ba1ae575ccd567ec88f20201c0c47289606c614ac0bead2c3edc6b')
          OR ("merchant_ai_consent_evidence"."notice_version" = 'merchant-ai-notice-2026-08-19.v1'
            AND "merchant_ai_consent_evidence"."notice_digest" = 'f0d809baa42995be174a536561a56f4c6656e9b1a60feb5773466f2d1eb2bf31')
          OR ("merchant_ai_consent_evidence"."notice_version" = 'merchant-ai-notice-2026-09-06.v1'
            AND "merchant_ai_consent_evidence"."notice_digest" = '7bb8d9bddbec630d90f546ba4d0f308076840e25786389a19e1c651dd21434a8')
          OR ("merchant_ai_consent_evidence"."notice_version" = 'merchant-ai-notice-2026-09-08.v1'
            AND "merchant_ai_consent_evidence"."notice_digest" = 'c24030bc98918d3fa6a8e820bf6bca6489a4c8835cf61bd12ab6b84a8f0a0865')
          OR ("merchant_ai_consent_evidence"."notice_version" = 'merchant-ai-notice-2026-09-09.v1'
            AND "merchant_ai_consent_evidence"."notice_digest" = 'd80fe3b03f89697cde6c46810053248206aa3745b5f4a5522a24c1c2fdb438e1')
          OR ("merchant_ai_consent_evidence"."notice_version" = 'merchant-ai-notice-2026-09-15.v1'
            AND "merchant_ai_consent_evidence"."notice_digest" = '6c98ae3bb57b5b142afed1749a1b9f59be8d6ca7edaca3250e39055897289a9c')
          OR ("merchant_ai_consent_evidence"."notice_version" = 'merchant-ai-notice-2026-10-17.v1'
            AND "merchant_ai_consent_evidence"."notice_digest" = '2bcd2be15cbb81f324f9a9390ad00baff3ffbb25a6c0db8bff71fbb2b1b0975e')
          OR ("merchant_ai_consent_evidence"."notice_version" = 'merchant-ai-notice-2026-10-30.v1'
            AND "merchant_ai_consent_evidence"."notice_digest" = 'dadad7b81dbda360678fc57f7265b104c7311cbc213f877f32306c53b4852a5e')
        )
        AND "merchant_ai_consent_evidence"."source_policy_id" = 'google-business-profile-source-policy-v1'
        AND "merchant_ai_consent_evidence"."routing_policy_version" = 1
        AND "merchant_ai_consent_evidence"."redaction_profile_family" = 'gbp-review-global-v1');--> statement-breakpoint
ALTER TABLE "merchant_ai_consent_evidence" ADD CONSTRAINT "merchant_ai_consent_evidence_profile_valid" CHECK ("merchant_ai_consent_evidence"."provider_deployment_profile_version" IN ('private-beta-global-v1', 'private-beta-global-v2'));--> statement-breakpoint
ALTER TABLE "merchant_ai_consent_evidence" ADD CONSTRAINT "merchant_ai_consent_evidence_runtime_map_valid" CHECK ((
    ("capabilities" = ARRAY[]::text[] AND "capability_runtime_profile_versions" = '{}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis']::text[] AND "capability_runtime_profile_versions" = '{"review_analysis": "review-analysis-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis']::text[] AND "capability_runtime_profile_versions" = '{"review_analysis": "review-analysis-runtime-v2"}'::jsonb)
    OR ("capabilities" = ARRAY['reply_drafting']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'reply_drafting']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v1", "review_analysis": "review-analysis-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'reply_drafting']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v1", "review_analysis": "review-analysis-runtime-v2"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'property_trends']::text[] AND "capability_runtime_profile_versions" = '{"property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'property_trends']::text[] AND "capability_runtime_profile_versions" = '{"property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v2"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'reply_drafting', 'property_trends']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v1", "property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'reply_drafting', 'property_trends']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v1", "property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v2"}'::jsonb)
  ));--> statement-breakpoint
ALTER TABLE "merchant_ai_enablement" ADD CONSTRAINT "merchant_ai_enablement_contract_valid" CHECK ((
          ("merchant_ai_enablement"."notice_version" = 'merchant-ai-notice-2026-08-15.v1'
            AND "merchant_ai_enablement"."notice_digest" = '4ae20219b3ba1ae575ccd567ec88f20201c0c47289606c614ac0bead2c3edc6b')
          OR ("merchant_ai_enablement"."notice_version" = 'merchant-ai-notice-2026-08-19.v1'
            AND "merchant_ai_enablement"."notice_digest" = 'f0d809baa42995be174a536561a56f4c6656e9b1a60feb5773466f2d1eb2bf31')
          OR ("merchant_ai_enablement"."notice_version" = 'merchant-ai-notice-2026-09-06.v1'
            AND "merchant_ai_enablement"."notice_digest" = '7bb8d9bddbec630d90f546ba4d0f308076840e25786389a19e1c651dd21434a8')
          OR ("merchant_ai_enablement"."notice_version" = 'merchant-ai-notice-2026-09-08.v1'
            AND "merchant_ai_enablement"."notice_digest" = 'c24030bc98918d3fa6a8e820bf6bca6489a4c8835cf61bd12ab6b84a8f0a0865')
          OR ("merchant_ai_enablement"."notice_version" = 'merchant-ai-notice-2026-09-09.v1'
            AND "merchant_ai_enablement"."notice_digest" = 'd80fe3b03f89697cde6c46810053248206aa3745b5f4a5522a24c1c2fdb438e1')
          OR ("merchant_ai_enablement"."notice_version" = 'merchant-ai-notice-2026-09-15.v1'
            AND "merchant_ai_enablement"."notice_digest" = '6c98ae3bb57b5b142afed1749a1b9f59be8d6ca7edaca3250e39055897289a9c')
          OR ("merchant_ai_enablement"."notice_version" = 'merchant-ai-notice-2026-10-17.v1'
            AND "merchant_ai_enablement"."notice_digest" = '2bcd2be15cbb81f324f9a9390ad00baff3ffbb25a6c0db8bff71fbb2b1b0975e')
          OR ("merchant_ai_enablement"."notice_version" = 'merchant-ai-notice-2026-10-30.v1'
            AND "merchant_ai_enablement"."notice_digest" = 'dadad7b81dbda360678fc57f7265b104c7311cbc213f877f32306c53b4852a5e')
        )
        AND "merchant_ai_enablement"."source_policy_id" = 'google-business-profile-source-policy-v1'
        AND "merchant_ai_enablement"."routing_policy_version" = 1
        AND "merchant_ai_enablement"."redaction_profile_family" = 'gbp-review-global-v1');--> statement-breakpoint
ALTER TABLE "merchant_ai_enablement" ADD CONSTRAINT "merchant_ai_enablement_profile_valid" CHECK ("merchant_ai_enablement"."provider_deployment_profile_version" IN ('private-beta-global-v1', 'private-beta-global-v2'));--> statement-breakpoint
ALTER TABLE "merchant_ai_enablement" ADD CONSTRAINT "merchant_ai_enablement_runtime_map_valid" CHECK ((
    ("capabilities" = ARRAY[]::text[] AND "capability_runtime_profile_versions" = '{}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis']::text[] AND "capability_runtime_profile_versions" = '{"review_analysis": "review-analysis-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis']::text[] AND "capability_runtime_profile_versions" = '{"review_analysis": "review-analysis-runtime-v2"}'::jsonb)
    OR ("capabilities" = ARRAY['reply_drafting']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'reply_drafting']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v1", "review_analysis": "review-analysis-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'reply_drafting']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v1", "review_analysis": "review-analysis-runtime-v2"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'property_trends']::text[] AND "capability_runtime_profile_versions" = '{"property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'property_trends']::text[] AND "capability_runtime_profile_versions" = '{"property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v2"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'reply_drafting', 'property_trends']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v1", "property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'reply_drafting', 'property_trends']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v1", "property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v2"}'::jsonb)
  ));--> statement-breakpoint
INSERT INTO ai_execution_control_transitions (control_id, generation, scope_key, scope_kind, scope_value, execution_state, reason_code, actor_user_id, occurred_at, predecessor_generation, admission_state, ticket_reference, candidate_release_sha) VALUES ('00000000-0000-4000-8000-00000000a006', 1, 'provider:private-beta-global-v2', 'provider_deployment_profile', 'private-beta-global-v2', 'enabled', 'migration_seed', NULL, now(), NULL, 'accepting', 'migration-0083', NULL);--> statement-breakpoint
INSERT INTO ai_execution_control_heads (scope_key, scope_kind, scope_value, control_id, generation, execution_state, updated_at, admission_state) VALUES ('provider:private-beta-global-v2', 'provider_deployment_profile', 'private-beta-global-v2', '00000000-0000-4000-8000-00000000a006', 1, 'enabled', now(), 'accepting');
