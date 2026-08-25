CREATE TABLE "user_organization_bindings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"state" text DEFAULT 'active' NOT NULL,
	"source" text NOT NULL,
	"invitation_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"resolution_reason" text,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_organization_bindings_state_valid" CHECK ("user_organization_bindings"."state" IN ('active', 'support_resolution', 'released')),
	CONSTRAINT "user_organization_bindings_source_valid" CHECK ("user_organization_bindings"."source" IN ('invitation', 'operator', 'backfill')),
	CONSTRAINT "user_organization_bindings_version_positive" CHECK ("user_organization_bindings"."version" > 0),
	CONSTRAINT "user_organization_bindings_state_shape" CHECK ((
        ("user_organization_bindings"."state" = 'active' AND "user_organization_bindings"."organization_id" IS NOT NULL AND "user_organization_bindings"."released_at" IS NULL)
        OR ("user_organization_bindings"."state" = 'support_resolution' AND "user_organization_bindings"."released_at" IS NULL)
        OR ("user_organization_bindings"."state" = 'released' AND "user_organization_bindings"."released_at" IS NOT NULL)
      ))
);
--> statement-breakpoint
CREATE INDEX "user_organization_bindings_org_state_idx" ON "user_organization_bindings" USING btree ("organization_id","state");--> statement-breakpoint
-- Deterministic expand backfill. Exactly one distinct membership is mappable;
-- multiple Organizations are never guessed and enter support resolution.
WITH membership_summary AS (
	SELECT
		"userId" AS user_id,
		COUNT(DISTINCT "organizationId")::integer AS organization_count,
		MIN("organizationId") AS sole_organization_id
	FROM member
	GROUP BY "userId"
)
INSERT INTO user_organization_bindings (
	user_id,
	organization_id,
	state,
	source,
	version,
	resolution_reason,
	created_at,
	updated_at
)
SELECT
	user_id,
	CASE WHEN organization_count = 1 THEN sole_organization_id ELSE NULL END,
	CASE WHEN organization_count = 1 THEN 'active' ELSE 'support_resolution' END,
	'backfill',
	1,
	CASE WHEN organization_count = 1 THEN NULL ELSE 'existing_multiple_memberships' END,
	NOW(),
	NOW()
FROM membership_summary
ON CONFLICT (user_id) DO NOTHING;
