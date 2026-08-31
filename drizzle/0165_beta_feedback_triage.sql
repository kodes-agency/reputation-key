-- OBS-01: content-free local authority for feedback delivery and triage.
-- User-authored text and masked attachment bytes remain in the restricted
-- monitoring project; PostgreSQL stores only controlled workflow evidence.
CREATE TABLE "beta_feedback_triage" (
	"reference" uuid PRIMARY KEY NOT NULL,
	"organization_pseudonym" char(64) NOT NULL,
	"actor_pseudonym" char(64) NOT NULL,
	"feedback_type" varchar(16) NOT NULL,
	"impact_code" varchar(32) NOT NULL,
	"route_key" varchar(80) NOT NULL,
	"viewport" varchar(16) NOT NULL,
	"reporter_role" varchar(32) NOT NULL,
	"delivery_state" varchar(16) NOT NULL,
	"provider_reference" varchar(64),
	"delivery_failure_code" varchar(48),
	"attachment_kind" varchar(32) NOT NULL,
	"attachment_captured_at" timestamp with time zone,
	"attachment_expires_at" timestamp with time zone,
	"triage_state" varchar(24) DEFAULT 'new' NOT NULL,
	"severity" varchar(16) DEFAULT 'unclassified' NOT NULL,
	"privacy_class" varchar(16) DEFAULT 'pending' NOT NULL,
	"security_class" varchar(16) DEFAULT 'pending' NOT NULL,
	"reproduction" varchar(24) DEFAULT 'pending' NOT NULL,
	"dedupe_disposition" varchar(16) DEFAULT 'pending' NOT NULL,
	"duplicate_of_reference" uuid,
	"owner_queue" varchar(24) DEFAULT 'beta_support' NOT NULL,
	"owner_pseudonym" char(64),
	"customer_response" varchar(24) DEFAULT 'pending' NOT NULL,
	"engineering_issue_ref" varchar(200),
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "beta_feedback_triage_pseudonyms_valid" CHECK ("organization_pseudonym" ~ '^[a-f0-9]{64}$' AND "actor_pseudonym" ~ '^[a-f0-9]{64}$' AND ("owner_pseudonym" IS NULL OR "owner_pseudonym" ~ '^[a-f0-9]{64}$')),
	CONSTRAINT "beta_feedback_triage_feedback_type_valid" CHECK ("feedback_type" IN ('bug', 'suggestion')),
	CONSTRAINT "beta_feedback_triage_impact_valid" CHECK ("impact_code" IN ('cannot_complete', 'workaround_available', 'small_issue', 'important', 'helpful', 'nice_to_have')),
	CONSTRAINT "beta_feedback_triage_viewport_valid" CHECK ("viewport" IN ('compact', 'regular', 'wide')),
	CONSTRAINT "beta_feedback_triage_reporter_role_valid" CHECK ("reporter_role" IN ('AccountAdmin', 'PropertyManager', 'Staff')),
	CONSTRAINT "beta_feedback_triage_delivery_valid" CHECK ("delivery_state" IN ('prepared', 'delivered', 'failed')),
	CONSTRAINT "beta_feedback_triage_delivery_shape" CHECK (("delivery_state" = 'prepared' AND "provider_reference" IS NULL AND "delivery_failure_code" IS NULL) OR ("delivery_state" = 'delivered' AND "provider_reference" ~ '^[a-f0-9]{32,64}$' AND "delivery_failure_code" IS NULL) OR ("delivery_state" = 'failed' AND "provider_reference" IS NULL AND "delivery_failure_code" ~ '^[a-z][a-z0-9_]{0,47}$')),
	CONSTRAINT "beta_feedback_triage_attachment_kind_valid" CHECK ("attachment_kind" IN ('none', 'masked_layout_v1')),
	CONSTRAINT "beta_feedback_triage_attachment_shape" CHECK (("attachment_kind" = 'none' AND "attachment_captured_at" IS NULL AND "attachment_expires_at" IS NULL) OR ("attachment_kind" = 'masked_layout_v1' AND "feedback_type" = 'bug' AND "attachment_captured_at" IS NOT NULL AND "attachment_expires_at" > "attachment_captured_at" AND "attachment_expires_at" <= "attachment_captured_at" + interval '30 days')),
	CONSTRAINT "beta_feedback_triage_state_valid" CHECK ("triage_state" IN ('new', 'screened', 'reproducing', 'accepted', 'declined', 'resolved')),
	CONSTRAINT "beta_feedback_triage_severity_valid" CHECK ("severity" IN ('unclassified', 'P0', 'P1', 'P2', 'P3')),
	CONSTRAINT "beta_feedback_triage_privacy_valid" CHECK ("privacy_class" IN ('pending', 'clear', 'restricted', 'escalated')),
	CONSTRAINT "beta_feedback_triage_security_valid" CHECK ("security_class" IN ('pending', 'none', 'suspected', 'confirmed')),
	CONSTRAINT "beta_feedback_triage_reproduction_valid" CHECK ("reproduction" IN ('pending', 'reproduced', 'not_reproduced', 'not_applicable')),
	CONSTRAINT "beta_feedback_triage_dedupe_valid" CHECK ("dedupe_disposition" IN ('pending', 'unique', 'duplicate') AND (("dedupe_disposition" = 'duplicate' AND "duplicate_of_reference" IS NOT NULL AND "duplicate_of_reference" <> "reference") OR ("dedupe_disposition" <> 'duplicate' AND "duplicate_of_reference" IS NULL))),
	CONSTRAINT "beta_feedback_triage_owner_valid" CHECK ("owner_queue" IN ('beta_support', 'privacy', 'security', 'engineering')),
	CONSTRAINT "beta_feedback_triage_customer_response_valid" CHECK ("customer_response" IN ('pending', 'not_required', 'sent')),
	CONSTRAINT "beta_feedback_triage_issue_ref_valid" CHECK ("engineering_issue_ref" IS NULL OR "engineering_issue_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'),
	CONSTRAINT "beta_feedback_triage_classification_shape" CHECK ("triage_state" = 'new' OR ("severity" <> 'unclassified' AND "privacy_class" <> 'pending' AND "security_class" <> 'pending' AND "owner_pseudonym" IS NOT NULL)),
	CONSTRAINT "beta_feedback_triage_security_owner_shape" CHECK ("security_class" NOT IN ('suspected', 'confirmed') OR "owner_queue" = 'security'),
	CONSTRAINT "beta_feedback_triage_privacy_owner_shape" CHECK ("privacy_class" <> 'escalated' OR "owner_queue" IN ('privacy', 'security')),
	CONSTRAINT "beta_feedback_triage_decision_shape" CHECK ("triage_state" NOT IN ('accepted', 'declined', 'resolved') OR ("reproduction" <> 'pending' AND "dedupe_disposition" <> 'pending')),
	CONSTRAINT "beta_feedback_triage_issue_shape" CHECK ("engineering_issue_ref" IS NULL OR "triage_state" IN ('accepted', 'resolved')),
	CONSTRAINT "beta_feedback_triage_resolution_shape" CHECK ("triage_state" <> 'resolved' OR "customer_response" <> 'pending'),
	CONSTRAINT "beta_feedback_triage_revision_nonnegative" CHECK ("revision" >= 0)
);--> statement-breakpoint
ALTER TABLE "beta_feedback_triage" ADD CONSTRAINT "beta_feedback_triage_duplicate_reference_fk" FOREIGN KEY ("duplicate_of_reference") REFERENCES "public"."beta_feedback_triage"("reference") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "beta_feedback_triage_provider_reference_unique" ON "beta_feedback_triage" USING btree ("provider_reference");--> statement-breakpoint
CREATE INDEX "beta_feedback_triage_work_queue_idx" ON "beta_feedback_triage" USING btree ("owner_queue", "triage_state", "updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "beta_feedback_triage_delivery_idx" ON "beta_feedback_triage" USING btree ("delivery_state", "created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "beta_feedback_triage_attachment_expiry_idx" ON "beta_feedback_triage" USING btree ("attachment_expires_at");--> statement-breakpoint
CREATE TABLE "beta_feedback_triage_transitions" (
	"transition_id" uuid PRIMARY KEY NOT NULL,
	"feedback_reference" uuid NOT NULL,
	"from_state" varchar(24) NOT NULL,
	"to_state" varchar(24) NOT NULL,
	"result_revision" integer NOT NULL,
	"severity" varchar(16) NOT NULL,
	"privacy_class" varchar(16) NOT NULL,
	"security_class" varchar(16) NOT NULL,
	"reproduction" varchar(24) NOT NULL,
	"dedupe_disposition" varchar(16) NOT NULL,
	"duplicate_of_reference" uuid,
	"owner_queue" varchar(24) NOT NULL,
	"owner_pseudonym" char(64),
	"customer_response" varchar(24) NOT NULL,
	"engineering_issue_ref" varchar(200),
	"operator_pseudonym" char(64) NOT NULL,
	"reason_code" varchar(64) NOT NULL,
	"support_evidence_ref" varchar(200) NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "beta_feedback_triage_transition_states_valid" CHECK ("from_state" IN ('new', 'screened', 'reproducing', 'accepted', 'declined', 'resolved') AND "to_state" IN ('new', 'screened', 'reproducing', 'accepted', 'declined', 'resolved')),
	CONSTRAINT "beta_feedback_triage_transition_revision_positive" CHECK ("result_revision" > 0),
	CONSTRAINT "beta_feedback_triage_transition_operator_valid" CHECK ("operator_pseudonym" ~ '^[a-f0-9]{64}$' AND ("owner_pseudonym" IS NULL OR "owner_pseudonym" ~ '^[a-f0-9]{64}$')),
	CONSTRAINT "beta_feedback_triage_transition_reason_valid" CHECK ("reason_code" ~ '^[a-z][a-z0-9_]{0,63}$' AND "support_evidence_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'),
	CONSTRAINT "beta_feedback_triage_transition_classification_shape" CHECK ("severity" IN ('unclassified', 'P0', 'P1', 'P2', 'P3') AND "privacy_class" IN ('pending', 'clear', 'restricted', 'escalated') AND "security_class" IN ('pending', 'none', 'suspected', 'confirmed') AND "reproduction" IN ('pending', 'reproduced', 'not_reproduced', 'not_applicable') AND "owner_queue" IN ('beta_support', 'privacy', 'security', 'engineering') AND "customer_response" IN ('pending', 'not_required', 'sent') AND ("to_state" = 'new' OR ("severity" <> 'unclassified' AND "privacy_class" <> 'pending' AND "security_class" <> 'pending' AND "owner_pseudonym" IS NOT NULL))),
	CONSTRAINT "beta_feedback_triage_transition_dedupe_shape" CHECK ("dedupe_disposition" IN ('pending', 'unique', 'duplicate') AND (("dedupe_disposition" = 'duplicate' AND "duplicate_of_reference" IS NOT NULL AND "duplicate_of_reference" <> "feedback_reference") OR ("dedupe_disposition" <> 'duplicate' AND "duplicate_of_reference" IS NULL))),
	CONSTRAINT "beta_feedback_triage_transition_owner_shape" CHECK (("security_class" NOT IN ('suspected', 'confirmed') OR "owner_queue" = 'security') AND ("privacy_class" <> 'escalated' OR "owner_queue" IN ('privacy', 'security'))),
	CONSTRAINT "beta_feedback_triage_transition_decision_shape" CHECK ("to_state" NOT IN ('accepted', 'declined', 'resolved') OR ("reproduction" <> 'pending' AND "dedupe_disposition" <> 'pending')),
	CONSTRAINT "beta_feedback_triage_transition_issue_shape" CHECK ("engineering_issue_ref" IS NULL OR ("engineering_issue_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$' AND "to_state" IN ('accepted', 'resolved'))),
	CONSTRAINT "beta_feedback_triage_transition_resolution_shape" CHECK ("to_state" <> 'resolved' OR "customer_response" <> 'pending')
);--> statement-breakpoint
ALTER TABLE "beta_feedback_triage_transitions" ADD CONSTRAINT "beta_feedback_triage_transitions_feedback_reference_beta_feedback_triage_reference_fk" FOREIGN KEY ("feedback_reference") REFERENCES "public"."beta_feedback_triage"("reference") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beta_feedback_triage_transitions" ADD CONSTRAINT "beta_feedback_triage_transition_duplicate_reference_fk" FOREIGN KEY ("duplicate_of_reference") REFERENCES "public"."beta_feedback_triage"("reference") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "beta_feedback_triage_transition_revision_unique" ON "beta_feedback_triage_transitions" USING btree ("feedback_reference", "result_revision");--> statement-breakpoint
CREATE INDEX "beta_feedback_triage_transition_reference_idx" ON "beta_feedback_triage_transitions" USING btree ("feedback_reference", "occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE FUNCTION "guard_beta_feedback_triage_revision_v1"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."reference" IS DISTINCT FROM OLD."reference"
     OR NEW."organization_pseudonym" IS DISTINCT FROM OLD."organization_pseudonym"
     OR NEW."actor_pseudonym" IS DISTINCT FROM OLD."actor_pseudonym"
     OR NEW."feedback_type" IS DISTINCT FROM OLD."feedback_type"
     OR NEW."impact_code" IS DISTINCT FROM OLD."impact_code"
     OR NEW."route_key" IS DISTINCT FROM OLD."route_key"
     OR NEW."viewport" IS DISTINCT FROM OLD."viewport"
     OR NEW."reporter_role" IS DISTINCT FROM OLD."reporter_role"
     OR NEW."attachment_kind" IS DISTINCT FROM OLD."attachment_kind"
     OR NEW."attachment_captured_at" IS DISTINCT FROM OLD."attachment_captured_at"
     OR NEW."attachment_expires_at" IS DISTINCT FROM OLD."attachment_expires_at"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'beta feedback receipt identity is immutable';
  END IF;

  IF NEW."revision" IS DISTINCT FROM OLD."revision" + 1 THEN
    RAISE EXCEPTION 'beta feedback triage revision must advance by exactly one';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "beta_feedback_triage_revision_guard"
BEFORE UPDATE ON "beta_feedback_triage"
FOR EACH ROW EXECUTE FUNCTION "guard_beta_feedback_triage_revision_v1"();--> statement-breakpoint
ALTER TABLE "beta_feedback_triage" ENABLE ALWAYS TRIGGER "beta_feedback_triage_revision_guard";--> statement-breakpoint
CREATE FUNCTION "guard_beta_feedback_triage_transition_immutable_v1"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'beta feedback triage transitions are append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "beta_feedback_triage_transition_update_guard"
BEFORE UPDATE OR DELETE ON "beta_feedback_triage_transitions"
FOR EACH ROW EXECUTE FUNCTION "guard_beta_feedback_triage_transition_immutable_v1"();--> statement-breakpoint
ALTER TABLE "beta_feedback_triage_transitions" ENABLE ALWAYS TRIGGER "beta_feedback_triage_transition_update_guard";--> statement-breakpoint
CREATE TRIGGER "beta_feedback_triage_transition_truncate_guard"
BEFORE TRUNCATE ON "beta_feedback_triage_transitions"
FOR EACH STATEMENT EXECUTE FUNCTION "guard_beta_feedback_triage_transition_immutable_v1"();--> statement-breakpoint
ALTER TABLE "beta_feedback_triage_transitions" ENABLE ALWAYS TRIGGER "beta_feedback_triage_transition_truncate_guard";
