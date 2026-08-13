CREATE TABLE "property_operation_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"destination_property_id" uuid,
	"outcome" varchar(32) NOT NULL,
	"destination_source_epoch" integer NOT NULL,
	"destination_profile_version" integer NOT NULL,
	"tombstone" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"retention_released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_operation_receipts_outcome_valid" CHECK ("property_operation_receipts"."outcome" IN ('imported', 'relinked', 'property_deleted')),
	CONSTRAINT "property_operation_receipts_destination_valid" CHECK ((
        ("property_operation_receipts"."tombstone" = false AND "property_operation_receipts"."outcome" IN ('imported', 'relinked') AND "property_operation_receipts"."destination_property_id" IS NOT NULL)
        OR ("property_operation_receipts"."tombstone" = true AND "property_operation_receipts"."outcome" = 'property_deleted' AND "property_operation_receipts"."destination_property_id" IS NULL)
      )),
	CONSTRAINT "property_operation_receipts_generations_valid" CHECK ("property_operation_receipts"."destination_source_epoch" >= 0 AND "property_operation_receipts"."destination_profile_version" >= 1),
	CONSTRAINT "property_operation_receipts_expiry_valid" CHECK ("property_operation_receipts"."expires_at" > "property_operation_receipts"."created_at"),
	CONSTRAINT "property_operation_receipts_release_valid" CHECK ("property_operation_receipts"."retention_released_at" IS NULL OR "property_operation_receipts"."retention_released_at" >= "property_operation_receipts"."created_at")
);
--> statement-breakpoint
ALTER TABLE "property_operation_receipts" ADD CONSTRAINT "property_operation_receipts_destination_tenant_fk" FOREIGN KEY ("organization_id","destination_property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "property_operation_receipts_org_idempotency_unique" ON "property_operation_receipts" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "property_operation_receipts_releasable_expiry_idx" ON "property_operation_receipts" USING btree ("expires_at","id") WHERE "property_operation_receipts"."retention_released_at" IS NOT NULL;