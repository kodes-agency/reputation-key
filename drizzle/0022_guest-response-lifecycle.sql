CREATE TABLE "guest_responses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "property_id" uuid NOT NULL,
  "portal_id" uuid NOT NULL,
  "session_id" uuid NOT NULL,
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "rating" integer,
  "category_id" uuid,
  "response_text" text,
  "response_consent" boolean DEFAULT false NOT NULL,
  "text_consent" boolean DEFAULT false NOT NULL,
  "media_consent" boolean DEFAULT false NOT NULL,
  "correction_count" integer DEFAULT 0 NOT NULL,
  "submitted_at" timestamp with time zone,
  "corrected_at" timestamp with time zone,
  "moderated_at" timestamp with time zone,
  "retention_deadline" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "guest_responses_status_valid" CHECK ("status" IN ('pending', 'submitted', 'corrected', 'moderated', 'deleted', 'expired')),
  CONSTRAINT "guest_responses_rating_valid" CHECK ("rating" IS NULL OR "rating" BETWEEN 1 AND 5),
  CONSTRAINT "guest_responses_correction_count_valid" CHECK ("correction_count" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "guest_responses_org_id_key" ON "guest_responses" USING btree ("organization_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "guest_responses_session_portal_unique" ON "guest_responses" USING btree ("organization_id", "portal_id", "session_id");
--> statement-breakpoint
CREATE INDEX "guest_responses_portal_status_idx" ON "guest_responses" USING btree ("organization_id", "property_id", "portal_id", "status");
--> statement-breakpoint
ALTER TABLE "guest_responses" ADD CONSTRAINT "guest_responses_portal_tenant_fk" FOREIGN KEY ("organization_id", "portal_id") REFERENCES "public"."portals"("organization_id", "id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "guest_response_media" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "property_id" uuid NOT NULL,
  "portal_id" uuid NOT NULL,
  "response_id" uuid NOT NULL,
  "session_id" uuid NOT NULL,
  "object_key" varchar(700) NOT NULL,
  "content_type" varchar(40) NOT NULL,
  "declared_size_bytes" integer NOT NULL,
  "status" varchar(24) DEFAULT 'issued' NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "confirmed_at" timestamp with time zone,
  "processing_lease" uuid,
  "processing_started_at" timestamp with time zone,
  "public_url" varchar(1000),
  "ready_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "guest_response_media_status_valid" CHECK ("status" IN ('issued', 'processing', 'ready', 'purge_pending', 'deleted', 'quarantined', 'expired')),
  CONSTRAINT "guest_response_media_size_valid" CHECK ("declared_size_bytes" > 0 AND "declared_size_bytes" <= 10485760)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "guest_response_media_object_key_unique" ON "guest_response_media" USING btree ("object_key");
--> statement-breakpoint
CREATE INDEX "guest_response_media_response_status_idx" ON "guest_response_media" USING btree ("organization_id", "response_id", "status");
--> statement-breakpoint
ALTER TABLE "guest_response_media" ADD CONSTRAINT "guest_response_media_response_tenant_fk" FOREIGN KEY ("organization_id", "response_id") REFERENCES "public"."guest_responses"("organization_id", "id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "guest_response_media" ADD CONSTRAINT "guest_response_media_portal_tenant_fk" FOREIGN KEY ("organization_id", "portal_id") REFERENCES "public"."portals"("organization_id", "id") ON DELETE restrict ON UPDATE no action;
