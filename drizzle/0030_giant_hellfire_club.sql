DROP INDEX "google_connections_google_account_idx";--> statement-breakpoint
ALTER TABLE "google_connections" ALTER COLUMN "google_account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "google_connections" ALTER COLUMN "google_email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "google_connections" ADD COLUMN "google_subject" varchar(255);--> statement-breakpoint
ALTER TABLE "google_connections" ADD COLUMN "lifecycle_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "google_connections" ADD COLUMN "access_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "google_connections" ADD COLUMN "credential_generation" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "google_connections_google_subject_idx" ON "google_connections" USING btree ("google_subject") WHERE "google_connections"."google_subject" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "google_connections_google_account_idx" ON "google_connections" USING btree ("google_account_id") WHERE "google_connections"."google_account_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "google_connections" ADD CONSTRAINT "google_connections_identity_check" CHECK ((("google_subject" IS NOT NULL AND "google_account_id" IS NULL AND "google_email" IS NULL) OR ("google_subject" IS NULL AND "google_account_id" IS NOT NULL AND "google_email" IS NOT NULL) OR ("status" = 'disconnected' AND "google_subject" IS NULL AND "google_account_id" IS NULL AND "google_email" IS NULL)));--> statement-breakpoint
ALTER TABLE "google_connections" ADD CONSTRAINT "google_connections_versions_check" CHECK ("lifecycle_version" >= 1 AND "access_version" >= 1 AND "credential_generation" >= 1);--> statement-breakpoint