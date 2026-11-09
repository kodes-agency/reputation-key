-- Additive. Provider events are applied in the order they happened: the time an
-- address was last lifted from the provider's suppression list is kept, so a
-- delayed bounce from before the lifting cannot suppress it again. Deliveries
-- already applied are kept by id, so a redelivery is acknowledged only.
CREATE TABLE "notification_email_suppression_removals" (
	"address_hash" varchar(64) PRIMARY KEY NOT NULL,
	"removed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "notification_email_suppression_removals_address_hash_valid" CHECK ("notification_email_suppression_removals"."address_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "resend_webhook_deliveries" (
	"event_id" varchar(255) PRIMARY KEY NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
