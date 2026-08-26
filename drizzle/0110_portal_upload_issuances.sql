CREATE TABLE "portal_upload_issuances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"purpose" varchar(32) DEFAULT 'hero_image' NOT NULL,
	"object_key" varchar(500) NOT NULL,
	"content_type" varchar(64) NOT NULL,
	"declared_size_bytes" integer NOT NULL,
	"max_size_bytes" integer NOT NULL,
	"state" varchar(20) DEFAULT 'issued' NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"hero_derivative_key" varchar(500),
	"thumbnail_derivative_key" varchar(500),
	"hero_image_url" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_upload_issuances_purpose_valid" CHECK ("portal_upload_issuances"."purpose" = 'hero_image'),
	CONSTRAINT "portal_upload_issuances_content_type_valid" CHECK ("portal_upload_issuances"."content_type" IN ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "portal_upload_issuances_size_envelope_valid" CHECK ("portal_upload_issuances"."declared_size_bytes" BETWEEN 1 AND "portal_upload_issuances"."max_size_bytes" AND "portal_upload_issuances"."max_size_bytes" = 10485760),
	CONSTRAINT "portal_upload_issuances_expiry_valid" CHECK ("portal_upload_issuances"."expires_at" > "portal_upload_issuances"."issued_at"),
	CONSTRAINT "portal_upload_issuances_source_key_valid" CHECK ("portal_upload_issuances"."object_key" = 'private/portal-uploads/' || "portal_upload_issuances"."id"::text || '/source.' || CASE "portal_upload_issuances"."content_type" WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/webp' THEN 'webp' ELSE NULL END),
	CONSTRAINT "portal_upload_issuances_state_valid" CHECK ("portal_upload_issuances"."state" IN ('issued', 'consumed', 'finalized', 'superseded', 'rejected', 'expired')),
	CONSTRAINT "portal_upload_issuances_lifecycle_valid" CHECK ((
        ("portal_upload_issuances"."state" = 'issued' AND "portal_upload_issuances"."consumed_at" IS NULL AND "portal_upload_issuances"."finalized_at" IS NULL AND "portal_upload_issuances"."superseded_at" IS NULL AND "portal_upload_issuances"."rejected_at" IS NULL AND "portal_upload_issuances"."expired_at" IS NULL)
        OR ("portal_upload_issuances"."state" = 'consumed' AND "portal_upload_issuances"."consumed_at" IS NOT NULL AND "portal_upload_issuances"."finalized_at" IS NULL AND "portal_upload_issuances"."superseded_at" IS NULL AND "portal_upload_issuances"."rejected_at" IS NULL AND "portal_upload_issuances"."expired_at" IS NULL)
        OR ("portal_upload_issuances"."state" = 'finalized' AND "portal_upload_issuances"."consumed_at" IS NOT NULL AND "portal_upload_issuances"."finalized_at" IS NOT NULL AND "portal_upload_issuances"."superseded_at" IS NULL AND "portal_upload_issuances"."rejected_at" IS NULL AND "portal_upload_issuances"."expired_at" IS NULL AND "portal_upload_issuances"."hero_derivative_key" IS NOT NULL AND "portal_upload_issuances"."thumbnail_derivative_key" IS NOT NULL AND "portal_upload_issuances"."hero_image_url" IS NOT NULL)
        OR ("portal_upload_issuances"."state" = 'superseded' AND "portal_upload_issuances"."consumed_at" IS NOT NULL AND "portal_upload_issuances"."finalized_at" IS NULL AND "portal_upload_issuances"."superseded_at" IS NOT NULL AND "portal_upload_issuances"."rejected_at" IS NULL AND "portal_upload_issuances"."expired_at" IS NULL)
        OR ("portal_upload_issuances"."state" = 'rejected' AND "portal_upload_issuances"."consumed_at" IS NULL AND "portal_upload_issuances"."finalized_at" IS NULL AND "portal_upload_issuances"."superseded_at" IS NULL AND "portal_upload_issuances"."rejected_at" IS NOT NULL AND "portal_upload_issuances"."expired_at" IS NULL)
        OR ("portal_upload_issuances"."state" = 'expired' AND "portal_upload_issuances"."consumed_at" IS NULL AND "portal_upload_issuances"."finalized_at" IS NULL AND "portal_upload_issuances"."superseded_at" IS NULL AND "portal_upload_issuances"."rejected_at" IS NULL AND "portal_upload_issuances"."expired_at" IS NOT NULL)
      )),
	CONSTRAINT "portal_upload_issuances_derivative_keys_valid" CHECK ((
        ("portal_upload_issuances"."hero_derivative_key" IS NULL AND "portal_upload_issuances"."thumbnail_derivative_key" IS NULL)
        OR (
          "portal_upload_issuances"."hero_derivative_key" = 'public/portal-heroes/' || "portal_upload_issuances"."id"::text || '/hero.webp'
          AND "portal_upload_issuances"."thumbnail_derivative_key" = 'public/portal-heroes/' || "portal_upload_issuances"."id"::text || '/thumbnail.webp'
          AND "portal_upload_issuances"."hero_derivative_key" <> "portal_upload_issuances"."object_key"
          AND "portal_upload_issuances"."thumbnail_derivative_key" <> "portal_upload_issuances"."object_key"
        )
      )),
	CONSTRAINT "portal_upload_issuances_publication_valid" CHECK ((
        ("portal_upload_issuances"."state" = 'finalized' AND "portal_upload_issuances"."hero_derivative_key" IS NOT NULL AND "portal_upload_issuances"."thumbnail_derivative_key" IS NOT NULL AND "portal_upload_issuances"."hero_image_url" IS NOT NULL)
        OR ("portal_upload_issuances"."state" <> 'finalized' AND "portal_upload_issuances"."hero_derivative_key" IS NULL AND "portal_upload_issuances"."thumbnail_derivative_key" IS NULL AND "portal_upload_issuances"."hero_image_url" IS NULL)
      ))
);
--> statement-breakpoint
ALTER TABLE "portal_upload_issuances" ADD CONSTRAINT "portal_upload_issuances_portal_tenant_fk" FOREIGN KEY ("organization_id","property_id","portal_id") REFERENCES "public"."portals"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "portal_upload_issuances_object_key_unique" ON "portal_upload_issuances" USING btree ("object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_upload_issuances_one_processing_per_portal" ON "portal_upload_issuances" USING btree ("organization_id","portal_id","purpose") WHERE state = 'consumed';--> statement-breakpoint
CREATE INDEX "portal_upload_issuances_scope_idx" ON "portal_upload_issuances" USING btree ("organization_id","property_id","portal_id","id");--> statement-breakpoint
CREATE INDEX "portal_upload_issuances_expiry_idx" ON "portal_upload_issuances" USING btree ("state","expires_at");
