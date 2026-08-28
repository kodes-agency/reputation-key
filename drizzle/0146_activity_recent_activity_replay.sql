CREATE TABLE "recent_activity_replay_facts" (
	"replay_key" varchar(600) PRIMARY KEY NOT NULL,
	"projection_id" uuid,
	"source_kind" varchar(40) NOT NULL,
	"disposition" varchar(16) NOT NULL,
	"source_event_id" varchar(255),
	"source_event_type" text,
	"source_event_version" integer,
	"source_context" text,
	"source_aggregate_id" text,
	"organization_id" varchar(255) NOT NULL,
	"property_id" varchar(255),
	"actor_subject_id" varchar(255),
	"action" varchar(50),
	"resource_type" varchar(50),
	"resource_id" varchar(255),
	"transition_payload" jsonb,
	"source" varchar(20),
	"source_occurred_at" timestamp with time zone NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recent_activity_replay_source_kind_check" CHECK ("recent_activity_replay_facts"."source_kind" IN ('durable_fact', 'legacy_projection_snapshot')),
	CONSTRAINT "recent_activity_replay_disposition_check" CHECK ("recent_activity_replay_facts"."disposition" IN ('projectable', 'obsolete')),
	CONSTRAINT "recent_activity_replay_durable_source_check" CHECK (("recent_activity_replay_facts"."source_kind" = 'durable_fact' AND "recent_activity_replay_facts"."source_event_id" IS NOT NULL AND "recent_activity_replay_facts"."source_event_type" IS NOT NULL AND "recent_activity_replay_facts"."source_event_version" >= 1 AND "recent_activity_replay_facts"."source_context" IS NOT NULL AND "recent_activity_replay_facts"."source_aggregate_id" IS NOT NULL) OR ("recent_activity_replay_facts"."source_kind" = 'legacy_projection_snapshot' AND "recent_activity_replay_facts"."disposition" = 'projectable' AND "recent_activity_replay_facts"."source_event_type" IS NULL AND "recent_activity_replay_facts"."source_event_version" IS NULL AND "recent_activity_replay_facts"."source_context" IS NULL AND "recent_activity_replay_facts"."source_aggregate_id" IS NULL)),
	CONSTRAINT "recent_activity_replay_projection_check" CHECK (("recent_activity_replay_facts"."disposition" = 'projectable' AND "recent_activity_replay_facts"."projection_id" IS NOT NULL AND "recent_activity_replay_facts"."action" IS NOT NULL AND "recent_activity_replay_facts"."resource_type" IS NOT NULL AND "recent_activity_replay_facts"."resource_id" IS NOT NULL AND "recent_activity_replay_facts"."transition_payload" IS NOT NULL AND "recent_activity_replay_facts"."source" IN ('web', 'import')) OR ("recent_activity_replay_facts"."disposition" = 'obsolete' AND "recent_activity_replay_facts"."projection_id" IS NULL AND "recent_activity_replay_facts"."actor_subject_id" IS NULL AND "recent_activity_replay_facts"."action" IS NULL AND "recent_activity_replay_facts"."resource_type" IS NULL AND "recent_activity_replay_facts"."resource_id" IS NULL AND "recent_activity_replay_facts"."transition_payload" IS NULL AND "recent_activity_replay_facts"."source" IS NULL))
);
--> statement-breakpoint
CREATE INDEX "recent_activity_replay_org_time_idx" ON "recent_activity_replay_facts" USING btree ("organization_id","source_occurred_at" DESC NULLS LAST,"replay_key");--> statement-breakpoint
CREATE INDEX "recent_activity_replay_retention_idx" ON "recent_activity_replay_facts" USING btree ("source_occurred_at","replay_key");--> statement-breakpoint
CREATE INDEX "recent_activity_replay_source_event_idx" ON "recent_activity_replay_facts" USING btree ("source_event_id","organization_id");--> statement-breakpoint

-- Establish a deliberately labelled, content-free baseline for retained
-- supported Recent Activity rows. The old projection did not retain event
-- type/version, so this migration does not infer them. A later delivery of the
-- real durable fact atomically promotes the matching `event:*` row.
INSERT INTO "recent_activity_replay_facts" (
	"replay_key",
	"projection_id",
	"source_kind",
	"disposition",
	"source_event_id",
	"source_event_type",
	"source_event_version",
	"source_context",
	"source_aggregate_id",
	"organization_id",
	"property_id",
	"actor_subject_id",
	"action",
	"resource_type",
	"resource_id",
	"transition_payload",
	"source",
	"source_occurred_at",
	"captured_at"
)
SELECT CASE
		 WHEN "event_id" IS NULL THEN 'legacy:' || "id"::text
		 ELSE 'event:' || "organization_id" || ':' || "event_id"
	   END,
	   "id",
	   'legacy_projection_snapshot',
	   'projectable',
	   "event_id",
	   NULL,
	   NULL,
	   NULL,
	   NULL,
	   "organization_id",
	   "property_id",
	   CASE WHEN "actor_id" = 'system' THEN NULL ELSE "actor_id" END,
	   "action",
	   "resource_type",
	   "resource_id",
	   jsonb_build_object(
		 'subject', CASE
		   WHEN "payload"->>'subject' IN (
			 'escalation', 'inbox_item', 'integration', 'member', 'note',
			 'organization', 'property', 'reply', 'status'
		   ) THEN "payload"->>'subject'
		   ELSE "resource_type"
		 END,
		 'from', NULL,
		 'to', NULL,
		 'detail', NULL
	   ),
	   CASE WHEN "source" = 'import' THEN 'import' ELSE 'web' END,
	   "created_at",
	   now()
FROM "activity_log"
WHERE "created_at" >= now() - interval '90 days'
  AND ("action", "resource_type") IN (
	('created', 'inbox_item'),
	('changed', 'inbox_item'),
	('assigned', 'inbox_item'),
	('unassigned', 'inbox_item'),
	('escalated', 'inbox_item'),
	('deescalated', 'inbox_item'),
	('added', 'inbox_item'),
	('submitted', 'reply'),
	('approved', 'reply'),
	('rejected', 'reply'),
	('published', 'reply'),
	('changed', 'reply'),
	('created', 'property'),
	('changed', 'property'),
	('deleted', 'property'),
	('invited', 'member'),
	('added', 'member'),
	('deleted', 'member'),
	('changed', 'member'),
	('connected', 'integration'),
	('disconnected', 'integration'),
	('changed', 'integration'),
	('created', 'organization')
  )
ON CONFLICT ("replay_key") DO NOTHING;
