DROP INDEX "google_connections_org_account_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "google_connections_google_account_idx" ON "google_connections" USING btree ("google_account_id");