ALTER TABLE "gbp_import_request_items"
  DROP CONSTRAINT "gbp_import_request_items_authorization_snapshot_valid";
--> statement-breakpoint
ALTER TABLE "gbp_import_request_items"
  ALTER COLUMN "expected_execution_policy_version" TYPE varchar(32)
  USING "expected_execution_policy_version"::text;
--> statement-breakpoint
ALTER TABLE "gbp_import_request_items"
  ADD CONSTRAINT "gbp_import_request_items_authorization_snapshot_valid" CHECK ((
    (
      "approval_binding_id" IS NULL
      AND "expected_execution_policy_version" IS NULL
      AND "expected_google_content_policy_version" IS NULL
      AND "expected_emergency_kill_version" IS NULL
      AND "expected_actor_role" IS NULL
      AND "expected_permission_digest" IS NULL
    )
    OR (
      char_length("approval_binding_id") BETWEEN 1 AND 255
      AND char_length("expected_execution_policy_version") BETWEEN 1 AND 32
      AND "expected_google_content_policy_version" >= 0
      AND "expected_emergency_kill_version" >= 0
      AND char_length("expected_actor_role") BETWEEN 1 AND 50
      AND "expected_permission_digest" ~ '^[a-f0-9]{64}$'
    )
  ));
