ALTER TABLE "portal_upload_issuances" ADD COLUMN "source_deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "portal_upload_issuances_source_cleanup_idx" ON "portal_upload_issuances" USING btree ("expires_at","id") WHERE "portal_upload_issuances"."source_deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "portal_upload_issuances" ADD CONSTRAINT "portal_upload_issuances_source_cleanup_valid" CHECK ("portal_upload_issuances"."source_deleted_at" IS NULL OR "portal_upload_issuances"."state" IN ('finalized', 'superseded', 'rejected', 'expired'));
