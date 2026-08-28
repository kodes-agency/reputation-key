CREATE TABLE "google_organization_credential_homes" (
	"organization_id" varchar(255) NOT NULL,
	"authority_generation" integer NOT NULL,
	"home_cell_id" varchar(16) NOT NULL,
	"catalogue_policy_version" integer NOT NULL,
	"transition_reason" varchar(32) NOT NULL,
	"changed_by" varchar(255) NOT NULL,
	"change_ticket" varchar(255),
	"effective_from" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_organization_credential_homes_pk" PRIMARY KEY("organization_id","authority_generation"),
	CONSTRAINT "google_organization_credential_homes_binding_key" UNIQUE("organization_id","authority_generation","home_cell_id","catalogue_policy_version"),
	CONSTRAINT "google_organization_credential_homes_values_valid" CHECK ("google_organization_credential_homes"."authority_generation" >= 1 AND "google_organization_credential_homes"."catalogue_policy_version" >= 1 AND "google_organization_credential_homes"."home_cell_id" IN ('us', 'europe', 'global') AND "google_organization_credential_homes"."transition_reason" IN ('new_grant', 'governed_reconnect', 'legacy_backfill')),
	CONSTRAINT "google_organization_credential_homes_interval_valid" CHECK ("google_organization_credential_homes"."superseded_at" IS NULL OR "google_organization_credential_homes"."superseded_at" > "google_organization_credential_homes"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "google_credential_broker_replay" (
	"organization_id" varchar(255) NOT NULL,
	"lookup_key_version" varchar(32) NOT NULL,
	"grant_id_hmac" varchar(43) NOT NULL,
	"one_use_nonce_hmac" varchar(43) NOT NULL,
	"connection_id" varchar(255) NOT NULL,
	"property_id" varchar(255) NOT NULL,
	"home_cell_id" varchar(16) NOT NULL,
	"target_cell_id" varchar(16) NOT NULL,
	"target_gateway_identity" varchar(255) NOT NULL,
	"route_key" varchar(96) NOT NULL,
	"credential_home_authority_generation" integer NOT NULL,
	"connection_lifecycle_version" integer NOT NULL,
	"connection_access_version" integer NOT NULL,
	"credential_generation" integer NOT NULL,
	"property_source_epoch" integer NOT NULL,
	"request_digest_sha256" varchar(64) NOT NULL,
	"credential_binding_sha256" varchar(64) NOT NULL,
	"routing_directory_revision" bigint NOT NULL,
	"routing_policy_version" integer NOT NULL,
	"material_locator" varchar(255) NOT NULL,
	"material_encryption_key_id" varchar(255) NOT NULL,
	"material_binding_sha256" varchar(64) NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"state" varchar(16) NOT NULL,
	"redeemed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_credential_broker_replay_pk" PRIMARY KEY("organization_id","lookup_key_version","grant_id_hmac"),
	CONSTRAINT "google_credential_broker_replay_values_valid" CHECK ("google_credential_broker_replay"."lookup_key_version" ~ '^[a-z][a-z0-9_-]{0,31}$' AND "google_credential_broker_replay"."grant_id_hmac" ~ '^[A-Za-z0-9_-]{43}$' AND "google_credential_broker_replay"."one_use_nonce_hmac" ~ '^[A-Za-z0-9_-]{43}$' AND "google_credential_broker_replay"."request_digest_sha256" ~ '^[a-f0-9]{64}$' AND "google_credential_broker_replay"."credential_binding_sha256" ~ '^[a-f0-9]{64}$' AND "google_credential_broker_replay"."material_binding_sha256" ~ '^[a-f0-9]{64}$' AND "google_credential_broker_replay"."home_cell_id" IN ('us', 'europe', 'global') AND "google_credential_broker_replay"."target_cell_id" IN ('us', 'europe', 'global') AND "google_credential_broker_replay"."home_cell_id" <> "google_credential_broker_replay"."target_cell_id" AND "google_credential_broker_replay"."credential_home_authority_generation" >= 1 AND "google_credential_broker_replay"."connection_lifecycle_version" >= 1 AND "google_credential_broker_replay"."connection_access_version" >= 1 AND "google_credential_broker_replay"."credential_generation" >= 1 AND "google_credential_broker_replay"."property_source_epoch" >= 0 AND "google_credential_broker_replay"."routing_directory_revision" BETWEEN 1 AND 9007199254740991 AND "google_credential_broker_replay"."routing_policy_version" >= 1 AND "google_credential_broker_replay"."expires_at" > "google_credential_broker_replay"."issued_at" AND "google_credential_broker_replay"."state" IN ('issued', 'redeemed') AND (("google_credential_broker_replay"."state" = 'issued' AND "google_credential_broker_replay"."redeemed_at" IS NULL) OR ("google_credential_broker_replay"."state" = 'redeemed' AND "google_credential_broker_replay"."redeemed_at" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "google_credential_routing_directory_snapshots" (
	"revision" bigint PRIMARY KEY NOT NULL,
	"catalogue_policy_version" integer NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"digest_sha256" varchar(64) NOT NULL,
	"signature_key_version" varchar(32) NOT NULL,
	"signature" varchar(43) NOT NULL,
	"directory" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_credential_routing_directory_snapshot_valid" CHECK ("google_credential_routing_directory_snapshots"."revision" BETWEEN 1 AND 9007199254740991 AND "google_credential_routing_directory_snapshots"."catalogue_policy_version" >= 1 AND "google_credential_routing_directory_snapshots"."expires_at" > "google_credential_routing_directory_snapshots"."issued_at" AND "google_credential_routing_directory_snapshots"."digest_sha256" ~ '^[a-f0-9]{64}$' AND "google_credential_routing_directory_snapshots"."signature" ~ '^[A-Za-z0-9_-]{43}$')
);
--> statement-breakpoint
CREATE TABLE "google_credential_routing_directory_state" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"current_revision" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_credential_routing_directory_state_valid" CHECK ("google_credential_routing_directory_state"."singleton" = TRUE AND "google_credential_routing_directory_state"."current_revision" BETWEEN 0 AND 9007199254740991)
);
--> statement-breakpoint
ALTER TABLE "google_connections" DROP CONSTRAINT "google_connections_credential_home_pair_check";--> statement-breakpoint
ALTER TABLE "google_connections" DROP CONSTRAINT "google_connections_credential_home_value_check";--> statement-breakpoint
ALTER TABLE "google_connections" ADD COLUMN "credential_home_authority_generation" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "google_organization_credential_homes_current_idx" ON "google_organization_credential_homes" USING btree ("organization_id") WHERE "google_organization_credential_homes"."superseded_at" IS NULL;--> statement-breakpoint
CREATE INDEX "google_credential_broker_replay_expiry_idx" ON "google_credential_broker_replay" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "google_credential_routing_directory_expiry_idx" ON "google_credential_routing_directory_snapshots" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "google_connections" ADD CONSTRAINT "google_connections_credential_home_authority_fk" FOREIGN KEY ("organization_id","credential_home_authority_generation","credential_home_cell_id","credential_home_policy_version") REFERENCES "public"."google_organization_credential_homes"("organization_id","authority_generation","home_cell_id","catalogue_policy_version") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "google_connections" ADD CONSTRAINT "google_connections_credential_home_pair_check" CHECK ((("google_connections"."credential_home_cell_id" IS NULL)::int + ("google_connections"."credential_home_policy_version" IS NULL)::int + ("google_connections"."credential_home_authority_generation" IS NULL)::int) IN (0, 3)) NOT VALID;--> statement-breakpoint
ALTER TABLE "google_connections" ADD CONSTRAINT "google_connections_credential_home_value_check" CHECK ("google_connections"."credential_home_cell_id" IS NULL OR ("google_connections"."credential_home_cell_id" IN ('us', 'europe', 'global') AND "google_connections"."credential_home_policy_version" >= 1 AND "google_connections"."credential_home_authority_generation" >= 1)) NOT VALID;
