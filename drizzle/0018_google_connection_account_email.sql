-- Show people which Google account a connection is.
--
-- Connections were labelled "Organization Google account": ADR 0050 granted
-- only `openid` and Business Profile management, so the signed OIDC `sub` was
-- all RepKey knew. The OAuth request now also asks for `email` (a basic
-- scope), and the verified `email` claim of the ID token is stored here purely
-- as a display label. `google_subject` stays the sole identity.
--
-- The address is a Google-controlled identifier of the grant, so it follows
-- `google_subject`: every disconnect, departure and Organization purge nulls
-- both together, and the CHECK refuses an address without a subject. Rows that
-- predate the scope keep NULL until their next OAuth ceremony.
-- Hand-written; the matching model is src/shared/db/schema/google-connection.schema.ts.
ALTER TABLE "google_connections" ADD COLUMN "google_account_email" varchar(320);--> statement-breakpoint
ALTER TABLE "google_connections" ADD CONSTRAINT "google_connections_account_email_check" CHECK ("google_account_email" IS NULL OR "google_subject" IS NOT NULL);
