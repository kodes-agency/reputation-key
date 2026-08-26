ALTER TYPE "public"."google_import_v2_outcome" ADD VALUE 'user_cancelled' BEFORE 'policy_disabled';--> statement-breakpoint
CREATE TABLE "gbp_import_sagas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"request_id" uuid NOT NULL,
	"initiated_by" varchar(255) NOT NULL,
	"total_count" integer NOT NULL,
	"batch_count" integer NOT NULL,
	"wire_replay_key_version" varchar(32) NOT NULL,
	"wire_replay_digest" varchar(43) NOT NULL,
	"semantic_replay_key_version" varchar(32) NOT NULL,
	"semantic_replay_digest" varchar(43) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gbp_import_sagas_batch_shape_valid" CHECK ((
        "gbp_import_sagas"."total_count" >= 1
        AND "gbp_import_sagas"."batch_count" >= 1
        AND "gbp_import_sagas"."total_count" > ("gbp_import_sagas"."batch_count" - 1) * 100
        AND "gbp_import_sagas"."total_count" <= "gbp_import_sagas"."batch_count" * 100
      )),
	CONSTRAINT "gbp_import_sagas_replay_encoding_valid" CHECK ((
        "gbp_import_sagas"."wire_replay_key_version" ~ '^[a-z][a-z0-9_-]{0,31}$'
        AND "gbp_import_sagas"."semantic_replay_key_version" ~ '^[a-z][a-z0-9_-]{0,31}$'
        AND "gbp_import_sagas"."wire_replay_digest" ~ '^[A-Za-z0-9_-]{43}$'
        AND "gbp_import_sagas"."semantic_replay_digest" ~ '^[A-Za-z0-9_-]{43}$'
      ))
);
--> statement-breakpoint
ALTER TABLE "gbp_import_request_items" DROP CONSTRAINT "gbp_import_request_items_status_outcome_valid";--> statement-breakpoint
ALTER TABLE "gbp_import_requests" ADD COLUMN "saga_id" uuid;--> statement-breakpoint
ALTER TABLE "gbp_import_requests" ADD COLUMN "batch_ordinal" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "gbp_import_sagas_org_request_unique" ON "gbp_import_sagas" USING btree ("organization_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gbp_import_sagas_org_id_key" ON "gbp_import_sagas" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "gbp_import_sagas_initiated_request_idx" ON "gbp_import_sagas" USING btree ("organization_id","initiated_by","request_id");--> statement-breakpoint
ALTER TABLE "gbp_import_requests" ADD CONSTRAINT "gbp_import_requests_saga_tenant_fk" FOREIGN KEY ("organization_id","saga_id") REFERENCES "public"."gbp_import_sagas"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gbp_import_requests_saga_batch_unique" ON "gbp_import_requests" USING btree ("organization_id","saga_id","batch_ordinal");--> statement-breakpoint
ALTER TABLE "gbp_import_request_items" ADD CONSTRAINT "gbp_import_request_items_status_outcome_valid" CHECK ((
        ("gbp_import_request_items"."status" IN ('pending', 'processing') AND "gbp_import_request_items"."outcome_code" IS NULL)
        OR ("gbp_import_request_items"."status" = 'imported' AND "gbp_import_request_items"."outcome_code" = 'imported')
        OR ("gbp_import_request_items"."status" = 'relinked' AND "gbp_import_request_items"."outcome_code" = 'relinked')
        OR ("gbp_import_request_items"."status" = 'already_exists' AND "gbp_import_request_items"."outcome_code" = 'already_exists')
        OR ("gbp_import_request_items"."status" = 'region_unavailable' AND "gbp_import_request_items"."outcome_code" = 'region_unavailable')
        OR ("gbp_import_request_items"."status" = 'failed' AND "gbp_import_request_items"."outcome_code" IN ('active_binding_conflict', 'stale_binding', 'reauthentication_required', 'reconnect_required', 'temporarily_unavailable', 'cleanup_required', 'internal_error'))
        OR ("gbp_import_request_items"."status" = 'cancelled' AND "gbp_import_request_items"."outcome_code"::text IN ('authorization_changed', 'user_cancelled', 'policy_disabled', 'organization_suspended', 'property_suspended', 'property_deleted'))
      ));--> statement-breakpoint
ALTER TABLE "gbp_import_requests" ADD CONSTRAINT "gbp_import_requests_saga_batch_valid" CHECK ((
        ("gbp_import_requests"."saga_id" IS NULL AND "gbp_import_requests"."batch_ordinal" IS NULL)
        OR ("gbp_import_requests"."saga_id" IS NOT NULL AND "gbp_import_requests"."batch_ordinal" >= 0)
      ));