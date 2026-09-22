-- A one-click unsubscribe link must keep working while the mail sits in an
-- inbox.
--
-- The signed List-Unsubscribe token names only a queue row (urgent mail) or a
-- digest batch, and the unsubscribe resolved its (Property, category) scopes
-- from those rows. Retention deletes both after 90 days, so clicking
-- Unsubscribe on older mail verified the token, found nothing, answered 204,
-- and changed no preference: the client said "unsubscribed" and the mail kept
-- coming.
--
-- The optional scopes a message stands for are now kept when it is sent, in
-- their own table with a 365-day retention. Tokens issued before this table
-- existed still resolve through the queue rows while those remain.
CREATE TABLE "notification_unsubscribe_scopes" (
  "target_kind" varchar(16) NOT NULL,
  "target_id" uuid NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "user_id" varchar(255) NOT NULL,
  "property_id" uuid NOT NULL,
  "category" varchar(40) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notification_unsubscribe_scopes_pk" PRIMARY KEY("target_kind","target_id","property_id","category"),
  CONSTRAINT "notification_unsubscribe_scopes_target_kind_valid" CHECK ("notification_unsubscribe_scopes"."target_kind" IN ('email', 'digest')),
  CONSTRAINT "notification_unsubscribe_scopes_optional_only" CHECK ("notification_unsubscribe_scopes"."category" <> 'mandatory')
);
--> statement-breakpoint
CREATE INDEX "notification_unsubscribe_scopes_organization_idx" ON "notification_unsubscribe_scopes" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "notification_unsubscribe_scopes_retention_idx" ON "notification_unsubscribe_scopes" USING btree ("created_at");
--> statement-breakpoint
ALTER TABLE "notification_unsubscribe_scopes" ADD CONSTRAINT "notification_unsubscribe_scopes_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;
