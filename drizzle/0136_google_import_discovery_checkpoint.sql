CREATE TABLE "google_import_discovery_invalidations" (
	"invalidation_key" varchar(43) PRIMARY KEY NOT NULL,
	"key_version" varchar(32) NOT NULL,
	"scope_kind" varchar(32) NOT NULL,
	"invalidated_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "google_import_discovery_invalidations_key_valid" CHECK ("google_import_discovery_invalidations"."invalidation_key" ~ '^[A-Za-z0-9_-]{43}$' AND "google_import_discovery_invalidations"."key_version" ~ '^[a-z][a-z0-9_-]{0,31}$'),
	CONSTRAINT "google_import_discovery_invalidations_scope_valid" CHECK ("google_import_discovery_invalidations"."scope_kind" IN ('organization', 'user', 'user_connection', 'connection', 'property')),
	CONSTRAINT "google_import_discovery_invalidations_window_valid" CHECK ("google_import_discovery_invalidations"."expires_at" > "google_import_discovery_invalidations"."invalidated_at" AND "google_import_discovery_invalidations"."expires_at" <= "google_import_discovery_invalidations"."invalidated_at" + interval '00:00:30')
);
--> statement-breakpoint
CREATE TABLE "google_import_discovery_records" (
	"reference_key" varchar(43) PRIMARY KEY NOT NULL,
	"key_version" varchar(32) NOT NULL,
	"audience" varchar(32) NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"connection_id" uuid NOT NULL,
	"connection_lifecycle_version" integer NOT NULL,
	"connection_access_version" integer NOT NULL,
	"credential_generation" integer NOT NULL,
	"approval_binding_id" uuid NOT NULL,
	"authorization_vector" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"affected_property_id" uuid,
	"remaining_redemptions" integer,
	"claim_request_id" uuid,
	"claimed_at" timestamp with time zone,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_import_discovery_records_key_valid" CHECK ("google_import_discovery_records"."reference_key" ~ '^[A-Za-z0-9_-]{43}$' AND "google_import_discovery_records"."key_version" ~ '^[a-z][a-z0-9_-]{0,31}$'),
	CONSTRAINT "google_import_discovery_records_audience_valid" CHECK ("google_import_discovery_records"."audience" IN ('account_selection', 'accounts_cursor', 'locations_cursor', 'import_candidate')),
	CONSTRAINT "google_import_discovery_records_versions_valid" CHECK ("google_import_discovery_records"."connection_lifecycle_version" >= 1 AND "google_import_discovery_records"."connection_access_version" >= 1 AND "google_import_discovery_records"."credential_generation" >= 1),
	CONSTRAINT "google_import_discovery_records_window_valid" CHECK ("google_import_discovery_records"."expires_at" > "google_import_discovery_records"."issued_at" AND "google_import_discovery_records"."expires_at" <= "google_import_discovery_records"."issued_at" + interval '24 hours'),
	CONSTRAINT "google_import_discovery_records_cursor_budget_valid" CHECK ((
        ("google_import_discovery_records"."audience" IN ('accounts_cursor', 'locations_cursor') AND "google_import_discovery_records"."remaining_redemptions" BETWEEN 0 AND 50)
        OR ("google_import_discovery_records"."audience" NOT IN ('accounts_cursor', 'locations_cursor') AND "google_import_discovery_records"."remaining_redemptions" IS NULL)
      )),
	CONSTRAINT "google_import_discovery_records_claim_valid" CHECK (("google_import_discovery_records"."claim_request_id" IS NULL AND "google_import_discovery_records"."claimed_at" IS NULL) OR ("google_import_discovery_records"."audience" = 'import_candidate' AND "google_import_discovery_records"."claim_request_id" IS NOT NULL AND "google_import_discovery_records"."claimed_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "google_import_discovery_records" ADD CONSTRAINT "google_import_discovery_records_connection_tenant_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "public"."google_connections"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_import_discovery_records" ADD CONSTRAINT "google_import_discovery_records_property_tenant_fk" FOREIGN KEY ("organization_id","affected_property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "google_import_discovery_invalidations_expiry_idx" ON "google_import_discovery_invalidations" USING btree ("expires_at","invalidation_key");--> statement-breakpoint
CREATE INDEX "google_import_discovery_records_scope_idx" ON "google_import_discovery_records" USING btree ("organization_id","user_id","connection_id");--> statement-breakpoint
CREATE INDEX "google_import_discovery_records_property_idx" ON "google_import_discovery_records" USING btree ("organization_id","affected_property_id") WHERE "google_import_discovery_records"."affected_property_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "google_import_discovery_records_expiry_idx" ON "google_import_discovery_records" USING btree ("expires_at","reference_key");
