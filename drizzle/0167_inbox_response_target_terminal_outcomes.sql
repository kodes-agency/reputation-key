ALTER TABLE "inbox_handling_cycle_response_targets"
  DROP CONSTRAINT "inbox_handling_cycle_response_targets_values_valid";--> statement-breakpoint
ALTER TABLE "inbox_handling_cycle_response_targets"
  ADD CONSTRAINT "inbox_handling_cycle_response_targets_values_valid" CHECK (
    "cycle_number" BETWEEN 1 AND '9007199254740991'::bigint
    AND "source_revision" BETWEEN 1 AND '9007199254740991'::bigint
    AND "target_kind" IN ('google_review_response', 'private_feedback_handling')
    AND "performance_eligibility" IN ('measured', 'legacy_unknown', 'historical_onboarding')
    AND (
      ("target_kind" = 'google_review_response' AND "source_type" = 'review')
      OR ("target_kind" = 'private_feedback_handling' AND "source_type" = 'feedback')
    )
    AND (
      (
        "performance_eligibility" = 'measured'
        AND "duration_minutes" BETWEEN 1 AND 43200
        AND "policy_source" IN ('builtin_default', 'organization_policy', 'property_override')
        AND ("target_kind" = 'private_feedback_handling' OR "policy_source" <> 'property_override')
        AND "policy_version" BETWEEN 1 AND '9007199254740991'::bigint
        AND "start_at" IS NOT NULL
        AND "due_at" = "start_at" + make_interval(mins => "duration_minutes")
      ) OR (
        "performance_eligibility" <> 'measured'
        AND "duration_minutes" IS NULL
        AND "policy_source" IS NULL
        AND "policy_version" IS NULL
        AND "start_at" IS NULL
        AND "due_at" IS NULL
      )
    )
    AND (
      ("completion_at" IS NULL AND "result" IS NULL AND "stop_reason" IS NULL)
      OR (
        "performance_eligibility" = 'measured'
        AND (
          (
            "result" IN ('on_time', 'late')
            AND "completion_at" >= "start_at"
            AND "stop_reason" IN ('private_feedback_handled', 'confirmed_on_google')
          )
          OR (
            "result" = 'cancelled'
            AND "stop_reason" IN ('guest_withdrawn', 'superseded_by_source_revision', 'source_ineligible')
          )
        )
        AND (
          "result" = 'cancelled'
          OR (
            (("result" = 'on_time') = ("completion_at" <= "due_at"))
            AND (("result" = 'late') = ("completion_at" > "due_at"))
          )
        )
      )
    )
  );--> statement-breakpoint
ALTER TABLE "inbox_handling_cycle_response_targets"
  DROP CONSTRAINT "inbox_handling_cycle_response_targets_source_stop_valid";--> statement-breakpoint
ALTER TABLE "inbox_handling_cycle_response_targets"
  ADD CONSTRAINT "inbox_handling_cycle_response_targets_source_stop_valid" CHECK (
    "stop_reason" IS NULL
    OR (
      "target_kind" = 'private_feedback_handling'
      AND "stop_reason" IN ('private_feedback_handled', 'guest_withdrawn', 'superseded_by_source_revision')
    )
    OR (
      "target_kind" = 'google_review_response'
      AND "stop_reason" IN ('confirmed_on_google', 'superseded_by_source_revision', 'source_ineligible')
    )
  );
