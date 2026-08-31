CREATE TABLE "operational_action_history_heads" (
	"organization_id" varchar(255) PRIMARY KEY NOT NULL,
	"last_sequence" bigint DEFAULT 0 NOT NULL,
	"last_recorded_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operational_action_history_heads_sequence_nonnegative" CHECK ("operational_action_history_heads"."last_sequence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "operational_action_history_legal_holds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"reason_code" varchar(128) NOT NULL,
	"protects_from" timestamp with time zone NOT NULL,
	"protects_through" timestamp with time zone,
	"placed_at" timestamp with time zone NOT NULL,
	"placed_by_actor_id" varchar(255) NOT NULL,
	"released_at" timestamp with time zone,
	"released_by_actor_id" varchar(255),
	"release_reason_code" varchar(128),
	CONSTRAINT "operational_action_history_hold_interval_valid" CHECK ("operational_action_history_legal_holds"."protects_through" IS NULL OR "operational_action_history_legal_holds"."protects_through" >= "operational_action_history_legal_holds"."protects_from"),
	CONSTRAINT "operational_action_history_hold_release_valid" CHECK (("operational_action_history_legal_holds"."released_at" IS NULL AND "operational_action_history_legal_holds"."released_by_actor_id" IS NULL AND "operational_action_history_legal_holds"."release_reason_code" IS NULL) OR ("operational_action_history_legal_holds"."released_at" IS NOT NULL AND "operational_action_history_legal_holds"."released_by_actor_id" IS NOT NULL AND "operational_action_history_legal_holds"."release_reason_code" IS NOT NULL AND "operational_action_history_legal_holds"."released_at" >= "operational_action_history_legal_holds"."placed_at")),
	CONSTRAINT "operational_action_history_hold_identifiers_valid" CHECK ("operational_action_history_legal_holds"."reason_code" ~ '^[a-z][a-z0-9_.:-]{0,127}$' AND "operational_action_history_legal_holds"."placed_by_actor_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$' AND ("operational_action_history_legal_holds"."released_by_actor_id" IS NULL OR "operational_action_history_legal_holds"."released_by_actor_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$') AND ("operational_action_history_legal_holds"."release_reason_code" IS NULL OR "operational_action_history_legal_holds"."release_reason_code" ~ '^[a-z][a-z0-9_.:-]{0,127}$'))
);
--> statement-breakpoint
CREATE TABLE "operational_action_history_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"sequence" bigint NOT NULL,
	"property_id" varchar(255),
	"actor_type" varchar(16) NOT NULL,
	"actor_id" varchar(255),
	"actor_redacted_at" timestamp with time zone,
	"action" varchar(80) NOT NULL,
	"outcome" varchar(16) NOT NULL,
	"resource_type" varchar(40) NOT NULL,
	"resource_id" varchar(255),
	"resource_redacted_at" timestamp with time zone,
	"reason_code" varchar(128),
	"provenance_kind" varchar(32) NOT NULL,
	"provenance_id" varchar(255) NOT NULL,
	"source_event_type" varchar(128),
	"source_event_version" integer,
	"source_context" varchar(128),
	"source_aggregate_id" varchar(255),
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "operational_action_history_sequence_positive" CHECK ("operational_action_history_records"."sequence" >= 1),
	CONSTRAINT "operational_action_history_outcome_valid" CHECK ("operational_action_history_records"."outcome" IN ('succeeded', 'denied', 'failed')),
	CONSTRAINT "operational_action_history_actor_valid" CHECK (("operational_action_history_records"."actor_type" IN ('user', 'operator', 'service') AND ("operational_action_history_records"."actor_id" IS NOT NULL OR "operational_action_history_records"."actor_redacted_at" IS NOT NULL)) OR ("operational_action_history_records"."actor_type" IN ('system', 'public') AND "operational_action_history_records"."actor_id" IS NULL AND "operational_action_history_records"."actor_redacted_at" IS NULL)),
	CONSTRAINT "operational_action_history_resource_valid" CHECK ("operational_action_history_records"."resource_id" IS NOT NULL OR "operational_action_history_records"."resource_redacted_at" IS NOT NULL OR "operational_action_history_records"."action" IN ('authentication.decision', 'authorization.decision')),
	CONSTRAINT "operational_action_history_identifier_shape" CHECK (("operational_action_history_records"."actor_id" IS NULL OR "operational_action_history_records"."actor_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$') AND ("operational_action_history_records"."resource_id" IS NULL OR "operational_action_history_records"."resource_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$') AND "operational_action_history_records"."provenance_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$' AND ("operational_action_history_records"."reason_code" IS NULL OR "operational_action_history_records"."reason_code" ~ '^[a-z][a-z0-9_.:-]{0,127}$')),
	CONSTRAINT "operational_action_history_provenance_valid" CHECK (("operational_action_history_records"."provenance_kind" = 'domain_fact' AND "operational_action_history_records"."source_event_type" ~ '^[a-z][a-z0-9_.:-]{0,127}$' AND "operational_action_history_records"."source_event_version" >= 1 AND "operational_action_history_records"."source_context" ~ '^[a-z][a-z0-9_.:-]{0,127}$' AND "operational_action_history_records"."source_aggregate_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$') OR ("operational_action_history_records"."provenance_kind" IN ('policy_decision', 'interactive_command', 'worker_command', 'operator_command', 'history_access', 'history_lifecycle') AND "operational_action_history_records"."source_event_type" IS NULL AND "operational_action_history_records"."source_event_version" IS NULL AND "operational_action_history_records"."source_context" IS NULL AND "operational_action_history_records"."source_aggregate_id" IS NULL)),
	CONSTRAINT "operational_action_history_kind_valid" CHECK (("operational_action_history_records"."action" = 'authentication.decision' AND "operational_action_history_records"."resource_type" = 'account') OR ("operational_action_history_records"."action" = 'authorization.decision' AND "operational_action_history_records"."resource_type" = 'policy') OR ("operational_action_history_records"."action" = 'member.role_changed' AND "operational_action_history_records"."resource_type" = 'member') OR ("operational_action_history_records"."action" = 'property_access.changed' AND "operational_action_history_records"."resource_type" = 'property_grant') OR ("operational_action_history_records"."action" = 'sensitive_data.accessed' AND "operational_action_history_records"."resource_type" = 'data_export') OR ("operational_action_history_records"."action" = 'sensitive_data.exported' AND "operational_action_history_records"."resource_type" = 'data_export') OR ("operational_action_history_records"."action" = 'capability.changed' AND "operational_action_history_records"."resource_type" = 'capability') OR ("operational_action_history_records"."action" = 'policy.changed' AND "operational_action_history_records"."resource_type" = 'policy') OR ("operational_action_history_records"."action" = 'google_connection.connected' AND "operational_action_history_records"."resource_type" = 'google_connection') OR ("operational_action_history_records"."action" = 'google_connection.disconnected' AND "operational_action_history_records"."resource_type" = 'google_connection') OR ("operational_action_history_records"."action" = 'google_reply.published' AND "operational_action_history_records"."resource_type" = 'reply') OR ("operational_action_history_records"."action" = 'guest_feedback.moderated' AND "operational_action_history_records"."resource_type" = 'feedback') OR ("operational_action_history_records"."action" = 'portal_upload.validated' AND "operational_action_history_records"."resource_type" = 'upload') OR ("operational_action_history_records"."action" = 'privacy_request.received' AND "operational_action_history_records"."resource_type" = 'privacy_request') OR ("operational_action_history_records"."action" = 'privacy_request.fulfilled' AND "operational_action_history_records"."resource_type" = 'privacy_request') OR ("operational_action_history_records"."action" = 'property.archived' AND "operational_action_history_records"."resource_type" = 'property') OR ("operational_action_history_records"."action" = 'property.restored' AND "operational_action_history_records"."resource_type" = 'property') OR ("operational_action_history_records"."action" = 'property.deleted' AND "operational_action_history_records"."resource_type" = 'property') OR ("operational_action_history_records"."action" = 'portal.archived' AND "operational_action_history_records"."resource_type" = 'portal') OR ("operational_action_history_records"."action" = 'portal.published' AND "operational_action_history_records"."resource_type" = 'portal') OR ("operational_action_history_records"."action" = 'operator.command_executed' AND "operational_action_history_records"."resource_type" = 'operator_command') OR ("operational_action_history_records"."action" = 'operational_history.accessed' AND "operational_action_history_records"."resource_type" = 'operational_history') OR ("operational_action_history_records"."action" = 'operational_history.exported' AND "operational_action_history_records"."resource_type" = 'operational_history') OR ("operational_action_history_records"."action" = 'operational_history.legal_hold_placed' AND "operational_action_history_records"."resource_type" = 'operational_history') OR ("operational_action_history_records"."action" = 'operational_history.legal_hold_released' AND "operational_action_history_records"."resource_type" = 'operational_history') OR ("operational_action_history_records"."action" = 'operational_history.redaction_applied' AND "operational_action_history_records"."resource_type" = 'operational_history') OR ("operational_action_history_records"."action" = 'operational_history.retention_assessed' AND "operational_action_history_records"."resource_type" = 'operational_history')),
	CONSTRAINT "operational_action_history_time_valid" CHECK ("operational_action_history_records"."recorded_at" >= "operational_action_history_records"."occurred_at" AND ("operational_action_history_records"."actor_redacted_at" IS NULL OR "operational_action_history_records"."actor_redacted_at" >= "operational_action_history_records"."recorded_at") AND ("operational_action_history_records"."resource_redacted_at" IS NULL OR "operational_action_history_records"."resource_redacted_at" >= "operational_action_history_records"."recorded_at"))
);
--> statement-breakpoint
CREATE INDEX "operational_action_history_hold_org_idx" ON "operational_action_history_legal_holds" USING btree ("organization_id","released_at","protects_from");--> statement-breakpoint
CREATE UNIQUE INDEX "operational_action_history_org_sequence_uniq" ON "operational_action_history_records" USING btree ("organization_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "operational_action_history_provenance_uniq" ON "operational_action_history_records" USING btree ("organization_id","provenance_kind","provenance_id");--> statement-breakpoint
CREATE INDEX "operational_action_history_org_time_idx" ON "operational_action_history_records" USING btree ("organization_id","occurred_at" DESC NULLS LAST,"sequence" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "operational_action_history_actor_idx" ON "operational_action_history_records" USING btree ("organization_id","actor_id","occurred_at");--> statement-breakpoint
CREATE INDEX "operational_action_history_resource_idx" ON "operational_action_history_records" USING btree ("organization_id","resource_type","resource_id","occurred_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "guard_operational_action_history_record_mutation_v1"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Operational Action History append-only core rejects %', TG_OP;
  END IF;

  IF ROW(
    NEW.id,
    NEW.organization_id,
    NEW.sequence,
    NEW.property_id,
    NEW.actor_type,
    NEW.action,
    NEW.outcome,
    NEW.resource_type,
    NEW.reason_code,
    NEW.provenance_kind,
    NEW.provenance_id,
    NEW.source_event_type,
    NEW.source_event_version,
    NEW.source_context,
    NEW.source_aggregate_id,
    NEW.occurred_at,
    NEW.recorded_at
  ) IS DISTINCT FROM ROW(
    OLD.id,
    OLD.organization_id,
    OLD.sequence,
    OLD.property_id,
    OLD.actor_type,
    OLD.action,
    OLD.outcome,
    OLD.resource_type,
    OLD.reason_code,
    OLD.provenance_kind,
    OLD.provenance_id,
    OLD.source_event_type,
    OLD.source_event_version,
    OLD.source_context,
    OLD.source_aggregate_id,
    OLD.occurred_at,
    OLD.recorded_at
  ) OR NOT (
    (NEW.actor_id IS NOT DISTINCT FROM OLD.actor_id
      AND NEW.actor_redacted_at IS NOT DISTINCT FROM OLD.actor_redacted_at)
    OR (OLD.actor_id IS NOT NULL
      AND NEW.actor_id IS NULL
      AND OLD.actor_redacted_at IS NULL
      AND NEW.actor_redacted_at IS NOT NULL)
  ) OR NOT (
    (NEW.resource_id IS NOT DISTINCT FROM OLD.resource_id
      AND NEW.resource_redacted_at IS NOT DISTINCT FROM OLD.resource_redacted_at)
    OR (OLD.resource_id IS NOT NULL
      AND NEW.resource_id IS NULL
      AND OLD.resource_redacted_at IS NULL
      AND NEW.resource_redacted_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Operational Action History append-only core rejects UPDATE';
  END IF;

  IF (
    NEW.actor_id IS DISTINCT FROM OLD.actor_id
    OR NEW.resource_id IS DISTINCT FROM OLD.resource_id
  ) AND EXISTS (
    SELECT 1
    FROM operational_action_history_legal_holds AS hold
    WHERE hold.organization_id = OLD.organization_id
      AND hold.released_at IS NULL
      AND OLD.occurred_at >= hold.protects_from
      AND (hold.protects_through IS NULL OR OLD.occurred_at <= hold.protects_through)
  ) THEN
    RAISE EXCEPTION 'Operational Action History active legal hold rejects redaction';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "operational_action_history_records_mutation_guard"
BEFORE UPDATE OR DELETE ON "operational_action_history_records"
FOR EACH ROW EXECUTE FUNCTION "guard_operational_action_history_record_mutation_v1"();
--> statement-breakpoint
CREATE TRIGGER "operational_action_history_records_truncate_guard"
BEFORE TRUNCATE ON "operational_action_history_records"
FOR EACH STATEMENT EXECUTE FUNCTION "guard_operational_action_history_record_mutation_v1"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "guard_operational_action_history_hold_mutation_v1"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Operational Action History append-only legal-hold evidence rejects %', TG_OP;
  END IF;

  IF ROW(
    NEW.id,
    NEW.organization_id,
    NEW.reason_code,
    NEW.protects_from,
    NEW.protects_through,
    NEW.placed_at,
    NEW.placed_by_actor_id
  ) IS DISTINCT FROM ROW(
    OLD.id,
    OLD.organization_id,
    OLD.reason_code,
    OLD.protects_from,
    OLD.protects_through,
    OLD.placed_at,
    OLD.placed_by_actor_id
  ) OR NOT (
    (NEW.released_at IS NOT DISTINCT FROM OLD.released_at
      AND NEW.released_by_actor_id IS NOT DISTINCT FROM OLD.released_by_actor_id
      AND NEW.release_reason_code IS NOT DISTINCT FROM OLD.release_reason_code)
    OR (OLD.released_at IS NULL
      AND OLD.released_by_actor_id IS NULL
      AND OLD.release_reason_code IS NULL
      AND NEW.released_at IS NOT NULL
      AND NEW.released_by_actor_id IS NOT NULL
      AND NEW.release_reason_code IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Operational Action History append-only legal-hold evidence rejects UPDATE';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "operational_action_history_legal_holds_mutation_guard"
BEFORE UPDATE OR DELETE ON "operational_action_history_legal_holds"
FOR EACH ROW EXECUTE FUNCTION "guard_operational_action_history_hold_mutation_v1"();
--> statement-breakpoint
CREATE TRIGGER "operational_action_history_legal_holds_truncate_guard"
BEFORE TRUNCATE ON "operational_action_history_legal_holds"
FOR EACH STATEMENT EXECUTE FUNCTION "guard_operational_action_history_hold_mutation_v1"();
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "operational_action_history_records" FROM PUBLIC;
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "operational_action_history_legal_holds" FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "guard_operational_action_history_head_mutation_v1"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Operational Action History sequence authority rejects %', TG_OP;
  END IF;

  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.last_sequence <> OLD.last_sequence + 1
    OR NEW.last_recorded_at IS NULL
    OR (OLD.last_recorded_at IS NOT NULL
      AND NEW.last_recorded_at < OLD.last_recorded_at)
    OR NEW.updated_at IS DISTINCT FROM NEW.last_recorded_at THEN
    RAISE EXCEPTION 'Operational Action History sequence authority rejects UPDATE';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "operational_action_history_heads_update_guard"
BEFORE UPDATE OR DELETE ON "operational_action_history_heads"
FOR EACH ROW EXECUTE FUNCTION "guard_operational_action_history_head_mutation_v1"();
--> statement-breakpoint
CREATE TRIGGER "operational_action_history_heads_truncate_guard"
BEFORE TRUNCATE ON "operational_action_history_heads"
FOR EACH STATEMENT EXECUTE FUNCTION "guard_operational_action_history_head_mutation_v1"();
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "operational_action_history_heads" FROM PUBLIC;
