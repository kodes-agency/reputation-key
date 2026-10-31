CREATE TABLE ai_draft_measurements (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
operation_id uuid NOT NULL CONSTRAINT ai_draft_measurements_operation_fk REFERENCES ai_operations(id) ON DELETE CASCADE,
organization_id varchar(255) NOT NULL,
property_id uuid NOT NULL,
review_id uuid NOT NULL,
actor_user_id varchar(255) NOT NULL,
request_key varchar(128) NOT NULL,
contract varchar(2) NOT NULL,
intent varchar(10) NOT NULL,
trigger varchar(10) NOT NULL,
tone varchar(20) NOT NULL,
language varchar(35) NOT NULL,
rating_band varchar(10) NOT NULL,
"case" varchar(40),
provider_attempts integer NOT NULL,
outcome varchar(10) NOT NULL,
refusal_code varchar(64),
latency_ms integer NOT NULL,
base_reply_revision bigint NOT NULL,
draft_pressed boolean NOT NULL DEFAULT false,
try_again_pressed boolean NOT NULL DEFAULT false,
shorter_pressed boolean NOT NULL DEFAULT false,
tone_pressed boolean NOT NULL DEFAULT false,
shown_at timestamptz,
dismissed_at timestamptz,
superseded_at timestamptz,
adopted_at timestamptz,
adopted_reply_id uuid,
adopted_revision bigint,
submitted_at timestamptz,
submitted_revision bigint,
edit_distance double precision,
edited_before_submit boolean,
published_at timestamptz,
created_at timestamptz NOT NULL,
CONSTRAINT ai_draft_measurements_tenant_fk FOREIGN KEY (organization_id, property_id) REFERENCES properties(organization_id, id) ON DELETE CASCADE,
CONSTRAINT ai_draft_measurements_contract_valid CHECK (contract::text = ANY (ARRAY['v1'::text, 'v2'::text])),
CONSTRAINT ai_draft_measurements_intent_valid CHECK (intent::text = ANY (ARRAY['explicit'::text, 'background'::text])),
CONSTRAINT ai_draft_measurements_trigger_valid CHECK (trigger::text = ANY (ARRAY['draft'::text, 'try_again'::text, 'shorter'::text, 'tone'::text])),
CONSTRAINT ai_draft_measurements_outcome_valid CHECK (outcome::text = ANY (ARRAY['ready'::text, 'refused'::text])),
CONSTRAINT ai_draft_measurements_bounds CHECK (provider_attempts >= 1 AND provider_attempts <= 2 AND latency_ms >= 0 AND base_reply_revision >= 0 AND base_reply_revision <= '9007199254740991'::bigint),
CONSTRAINT ai_draft_measurements_edit_valid CHECK ((edit_distance IS NULL OR (edit_distance >= 0::double precision AND edit_distance <= 1::double precision)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX ai_draft_measurements_request_unique ON ai_draft_measurements (organization_id, actor_user_id, request_key);
--> statement-breakpoint
CREATE INDEX ai_draft_measurements_created_idx ON ai_draft_measurements (created_at);
--> statement-breakpoint
CREATE TABLE ai_draft_measurement_links (
 reply_id uuid NOT NULL CONSTRAINT ai_draft_measurement_links_reply_fk REFERENCES replies(id) ON DELETE CASCADE,
 reply_revision bigint NOT NULL,
 generation_id uuid CONSTRAINT ai_draft_measurement_links_generation_fk REFERENCES ai_draft_measurements(id) ON DELETE CASCADE,
 CONSTRAINT ai_draft_measurement_links_reply_id_reply_revision_pk PRIMARY KEY (reply_id, reply_revision),
 CONSTRAINT ai_draft_measurement_links_revision_valid CHECK (reply_revision >= 1 AND reply_revision <= '9007199254740991'::bigint)
);
--> statement-breakpoint
CREATE INDEX ai_draft_measurement_links_generation_idx ON ai_draft_measurement_links (generation_id);
