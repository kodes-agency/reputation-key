ALTER TABLE "merchant_ai_consent_evidence" DROP CONSTRAINT "merchant_ai_consent_evidence_contract_valid";--> statement-breakpoint
ALTER TABLE "merchant_ai_enablement" DROP CONSTRAINT "merchant_ai_enablement_contract_valid";--> statement-breakpoint
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
          OR ("merchant_ai_consent_evidence"."notice_version" = 'merchant-ai-notice-2026-09-11.v1'
            AND "merchant_ai_consent_evidence"."notice_digest" = '4ee03c5e1f754d7544d659ecf4e40366b64668832bc307d2257f3653601c8649')
        )
        AND "merchant_ai_consent_evidence"."source_policy_id" = 'google-business-profile-source-policy-v1'
        AND "merchant_ai_consent_evidence"."routing_policy_version" = 1
        AND "merchant_ai_consent_evidence"."redaction_profile_family" = 'gbp-review-global-v1');--> statement-breakpoint
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
          OR ("merchant_ai_enablement"."notice_version" = 'merchant-ai-notice-2026-09-11.v1'
            AND "merchant_ai_enablement"."notice_digest" = '4ee03c5e1f754d7544d659ecf4e40366b64668832bc307d2257f3653601c8649')
        )
        AND "merchant_ai_enablement"."source_policy_id" = 'google-business-profile-source-policy-v1'
        AND "merchant_ai_enablement"."routing_policy_version" = 1
        AND "merchant_ai_enablement"."redaction_profile_family" = 'gbp-review-global-v1');