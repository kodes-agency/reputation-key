-- Privacy access/correction/withdrawal/erasure requests (LIF-01-T20).
--
-- Program bullet 9. Until now only the 24-hour self-service Guest path existed
-- and the `privacy_request.received` / `privacy_request.fulfilled` audit
-- actions were declared but never written.
--
-- Structural, not procedural:
--   - tenant AND property scoped (both NOT NULL) — an unscoped request cannot
--     be answered without reading across tenants;
--   - no subject content — the subject is the SHA-256 of a VERIFIED identifier;
--   - expiry-bound — an access package reference must carry an expiry, or the
--     export becomes a permanent secondary copy;
--   - no edge skips identity verification.
--
-- Expand-only: this migration only creates. It removes no column, table,
-- index, constraint, or compatibility mirror.
CREATE TABLE "privacy_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"subject_type" varchar(24) NOT NULL,
	"subject_ref" char(64) NOT NULL,
	"request_kind" varchar(24) NOT NULL,
	"state" varchar(24) NOT NULL,
	"verification_ref" varchar(200),
	"refusal_reason_code" varchar(64),
	"target_field" varchar(64),
	"content_classification" varchar(24) NOT NULL,
	"package_ref" varchar(200),
	"package_expires_at" timestamp with time zone,
	"evidence_ref" varchar(200) NOT NULL,
	"correlation_id" varchar(255) NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_requests_state_valid" CHECK ("privacy_requests"."state" IN ('received', 'verified', 'in_progress', 'fulfilled', 'refused')),
	CONSTRAINT "privacy_requests_kind_valid" CHECK ("privacy_requests"."request_kind" IN ('access', 'correction', 'withdrawal', 'erasure')),
	CONSTRAINT "privacy_requests_subject_type_valid" CHECK ("privacy_requests"."subject_type" IN ('guest', 'participant')),
	CONSTRAINT "privacy_requests_classification_valid" CHECK ("privacy_requests"."content_classification" IN ('content_free', 'personal', 'sensitive')),
	CONSTRAINT "privacy_requests_subject_ref_valid" CHECK ("privacy_requests"."subject_ref" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "privacy_requests_refs_valid" CHECK ("privacy_requests"."evidence_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'
        AND ("privacy_requests"."verification_ref" IS NULL OR "privacy_requests"."verification_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$')
        AND ("privacy_requests"."package_ref" IS NULL OR "privacy_requests"."package_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$')
        AND ("privacy_requests"."refusal_reason_code" IS NULL OR "privacy_requests"."refusal_reason_code" ~ '^[a-z][a-z0-9_]{0,63}$')
        AND ("privacy_requests"."target_field" IS NULL OR "privacy_requests"."target_field" ~ '^[a-z][a-z0-9_]{0,63}$')),
	CONSTRAINT "privacy_requests_verification_required" CHECK ("privacy_requests"."state" = 'received'
        OR ("privacy_requests"."verified_at" IS NOT NULL AND "privacy_requests"."verification_ref" IS NOT NULL)),
	CONSTRAINT "privacy_requests_refusal_reason_required" CHECK (("privacy_requests"."state" = 'refused') = ("privacy_requests"."refusal_reason_code" IS NOT NULL)),
	CONSTRAINT "privacy_requests_completion_valid" CHECK (("privacy_requests"."state" IN ('fulfilled', 'refused')) = ("privacy_requests"."completed_at" IS NOT NULL)),
	CONSTRAINT "privacy_requests_package_valid" CHECK ("privacy_requests"."package_ref" IS NULL
        OR ("privacy_requests"."request_kind" = 'access' AND "privacy_requests"."package_expires_at" IS NOT NULL
          AND "privacy_requests"."package_expires_at" > "privacy_requests"."received_at")),
	CONSTRAINT "privacy_requests_target_field_valid" CHECK ("privacy_requests"."target_field" IS NULL OR "privacy_requests"."request_kind" IN ('correction', 'withdrawal'))
);--> statement-breakpoint
CREATE INDEX "privacy_requests_scope_idx" ON "privacy_requests" USING btree ("organization_id","property_id","state");--> statement-breakpoint
CREATE INDEX "privacy_requests_subject_idx" ON "privacy_requests" USING btree ("subject_ref","received_at");--> statement-breakpoint

CREATE TABLE "privacy_request_transitions" (
	"request_id" uuid NOT NULL,
	"to_state" varchar(24) NOT NULL,
	"from_state" varchar(24) NOT NULL,
	"actor_type" varchar(24) NOT NULL,
	"actor_ref" varchar(255) NOT NULL,
	"evidence_ref" varchar(200) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_request_transitions_pk" PRIMARY KEY("request_id","to_state"),
	CONSTRAINT "privacy_request_transitions_states_valid" CHECK ("privacy_request_transitions"."to_state" IN ('received', 'verified', 'in_progress', 'fulfilled', 'refused') AND "privacy_request_transitions"."from_state" IN ('received', 'verified', 'in_progress', 'fulfilled', 'refused')),
	CONSTRAINT "privacy_request_transitions_actor_valid" CHECK ("privacy_request_transitions"."actor_type" IN ('subject', 'operator', 'system')),
	CONSTRAINT "privacy_request_transitions_evidence_valid" CHECK ("privacy_request_transitions"."evidence_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$')
);--> statement-breakpoint
ALTER TABLE "privacy_request_transitions" ADD CONSTRAINT "privacy_request_transitions_request_id_privacy_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."privacy_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "privacy_request_transitions_request_idx" ON "privacy_request_transitions" USING btree ("request_id","occurred_at");--> statement-breakpoint

-- The state machine, enforced independently of the application. Direct SQL is
-- exactly how a request would be walked from `received` to `fulfilled` without
-- ever verifying that the person asking is the person whose data it is.
CREATE FUNCTION "reject_privacy_request_mutation_v1"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  allowed boolean;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = TG_TABLE_NAME || ' evidence cannot be truncated';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = TG_TABLE_NAME || ' evidence cannot be deleted';
  END IF;
  IF TG_TABLE_NAME = 'privacy_request_transitions' THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'privacy_request_transitions is append-only';
  END IF;

  IF NEW.id <> OLD.id
     OR NEW.organization_id <> OLD.organization_id
     OR NEW.property_id <> OLD.property_id
     OR NEW.subject_ref <> OLD.subject_ref
     OR NEW.subject_type <> OLD.subject_type
     OR NEW.request_kind <> OLD.request_kind
     OR NEW.received_at <> OLD.received_at THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'privacy request subject binding is immutable';
  END IF;

  IF NEW.state = OLD.state THEN
    RETURN NEW;
  END IF;

  allowed := CASE OLD.state
    WHEN 'received' THEN NEW.state IN ('verified', 'refused')
    WHEN 'verified' THEN NEW.state IN ('in_progress', 'refused')
    WHEN 'in_progress' THEN NEW.state IN ('fulfilled', 'refused')
    ELSE false
  END;

  IF NOT allowed THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'invalid privacy request transition ' || OLD.state || ' -> ' || NEW.state;
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "privacy_requests_transition_guard"
BEFORE UPDATE OR DELETE ON "privacy_requests"
FOR EACH ROW EXECUTE FUNCTION "reject_privacy_request_mutation_v1"();--> statement-breakpoint
CREATE TRIGGER "privacy_requests_truncate_guard"
BEFORE TRUNCATE ON "privacy_requests"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_privacy_request_mutation_v1"();--> statement-breakpoint
CREATE TRIGGER "privacy_request_transitions_mutation_guard"
BEFORE UPDATE OR DELETE ON "privacy_request_transitions"
FOR EACH ROW EXECUTE FUNCTION "reject_privacy_request_mutation_v1"();--> statement-breakpoint
CREATE TRIGGER "privacy_request_transitions_truncate_guard"
BEFORE TRUNCATE ON "privacy_request_transitions"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_privacy_request_mutation_v1"();--> statement-breakpoint
ALTER TABLE "privacy_requests" ENABLE ALWAYS TRIGGER "privacy_requests_transition_guard";--> statement-breakpoint
ALTER TABLE "privacy_requests" ENABLE ALWAYS TRIGGER "privacy_requests_truncate_guard";--> statement-breakpoint
ALTER TABLE "privacy_request_transitions" ENABLE ALWAYS TRIGGER "privacy_request_transitions_mutation_guard";--> statement-breakpoint
ALTER TABLE "privacy_request_transitions" ENABLE ALWAYS TRIGGER "privacy_request_transitions_truncate_guard";--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "privacy_requests" FROM PUBLIC;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "privacy_request_transitions" FROM PUBLIC;
