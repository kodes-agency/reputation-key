-- The frozen authorization vector for a v2 import item was rebuilt from the
-- `expected_*` columns below, but two dimensions of the principal stage —
-- `principalKind` and `permissionVersion` — had no column. The cross-time
-- comparison is strict key-set equality, so the rebuilt 8-key vector could
-- never equal the recomputed 10-key one: EVERY import item cancelled as
-- `authorization_changed`.
--
-- Both columns are nullable and the snapshot check treats them exactly like
-- the other expectation columns: all present, or all absent. Items frozen
-- before this migration have neither, so they keep failing closed rather than
-- silently passing a fence they were never measured against.
ALTER TABLE "gbp_import_request_items"
  ADD COLUMN IF NOT EXISTS "expected_principal_kind" varchar(32);--> statement-breakpoint
ALTER TABLE "gbp_import_request_items"
  ADD COLUMN IF NOT EXISTS "expected_permission_version" integer;--> statement-breakpoint

ALTER TABLE "gbp_import_request_items"
  DROP CONSTRAINT IF EXISTS "gbp_import_request_items_authorization_snapshot_valid";--> statement-breakpoint

ALTER TABLE "gbp_import_request_items"
  ADD CONSTRAINT "gbp_import_request_items_authorization_snapshot_valid" CHECK ((
    (
      "gbp_import_request_items"."approval_binding_id" IS NULL
      AND "gbp_import_request_items"."expected_execution_policy_version" IS NULL
      AND "gbp_import_request_items"."expected_google_content_policy_version" IS NULL
      AND "gbp_import_request_items"."expected_emergency_kill_version" IS NULL
      AND "gbp_import_request_items"."expected_actor_role" IS NULL
      AND "gbp_import_request_items"."expected_permission_digest" IS NULL
      AND "gbp_import_request_items"."expected_principal_kind" IS NULL
      AND "gbp_import_request_items"."expected_permission_version" IS NULL
    )
    OR (
      char_length("gbp_import_request_items"."approval_binding_id") BETWEEN 1 AND 255
      AND char_length("gbp_import_request_items"."expected_execution_policy_version") BETWEEN 1 AND 32
      AND "gbp_import_request_items"."expected_google_content_policy_version" >= 0
      AND "gbp_import_request_items"."expected_emergency_kill_version" >= 0
      AND char_length("gbp_import_request_items"."expected_actor_role") BETWEEN 1 AND 50
      AND "gbp_import_request_items"."expected_permission_digest" ~ '^[a-f0-9]{64}$'
      AND char_length("gbp_import_request_items"."expected_principal_kind") BETWEEN 1 AND 32
      AND "gbp_import_request_items"."expected_permission_version" >= 0
    )
  ));
