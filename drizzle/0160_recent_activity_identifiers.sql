-- ACT-01: make Recent Activity terminology physical while retaining a rolling
-- compatibility path. ALTER TABLE preserves rows, identities, defaults, and
-- constraints in place; the single-table view remains automatically updatable
-- for an older binary or queued worker during the bounded drain window.

ALTER TABLE "activity_log" RENAME TO "recent_activity_entries";
ALTER INDEX "activity_log_resource_idx" RENAME TO "recent_activity_entries_resource_idx";
ALTER INDEX "activity_log_org_property_idx" RENAME TO "recent_activity_entries_org_property_idx";
ALTER INDEX "activity_log_event_id_idx" RENAME TO "recent_activity_entries_event_id_idx";
ALTER INDEX "activity_log_actor_idx" RENAME TO "recent_activity_entries_actor_idx";
ALTER INDEX "activity_log_event_id_org_uniq" RENAME TO "recent_activity_entries_event_id_org_uniq";

CREATE VIEW "activity_log" AS
SELECT
  "id",
  "actor_id",
  "actor_name",
  "actor_avatar_url",
  "actor_role",
  "action",
  "resource_type",
  "resource_id",
  "property_id",
  "organization_id",
  "payload",
  "event_id",
  "source",
  "created_at"
FROM "recent_activity_entries";

CREATE TABLE "recent_activity_vocabulary_reconciliations" (
  "operation_id" uuid PRIMARY KEY NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "source_action" varchar(50) NOT NULL,
  "source_resource_type" varchar(50) NOT NULL,
  "target_action" varchar(50) NOT NULL,
  "target_resource_type" varchar(50) NOT NULL,
  "target_fingerprint_sha256" varchar(64) NOT NULL,
  "target_count" integer NOT NULL,
  "updated_count" integer NOT NULL,
  "authorized_by" varchar(255) NOT NULL,
  "authorization_evidence_ref" varchar(200) NOT NULL,
  "applied_at" timestamp with time zone NOT NULL,
  CONSTRAINT "recent_activity_vocabulary_reconciliations_codes_valid" CHECK ("source_action" ~ '^[a-z][a-z0-9_]{0,49}$' AND "source_resource_type" ~ '^[a-z][a-z0-9_]{0,49}$' AND "target_action" ~ '^[a-z][a-z0-9_]{0,49}$' AND "target_resource_type" ~ '^[a-z][a-z0-9_]{0,49}$'),
  CONSTRAINT "recent_activity_vocabulary_reconciliations_fingerprint_valid" CHECK ("target_fingerprint_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "recent_activity_vocabulary_reconciliations_counts_valid" CHECK ("target_count" >= 1 AND "updated_count" = "target_count"),
  CONSTRAINT "recent_activity_vocabulary_reconciliations_evidence_ref_valid" CHECK ("authorization_evidence_ref" ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$'),
  CONSTRAINT "recent_activity_vocabulary_reconciliations_changes_kind" CHECK ("source_action" <> "target_action" OR "source_resource_type" <> "target_resource_type")
);

CREATE INDEX "recent_activity_vocabulary_reconciliations_org_time_idx"
  ON "recent_activity_vocabulary_reconciliations" USING btree ("organization_id", "applied_at" DESC NULLS LAST, "operation_id");
