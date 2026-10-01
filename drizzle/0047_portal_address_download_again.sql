-- Encrypted address and "Download again" (round 4, slice 33; ADR 0062).
--
-- Additive. `portal_tokens.issued_by` records who made a code (null for codes
-- made before this migration). `portal_address_downloads` records each time a
-- manager is handed an existing address, before the address is decrypted.
-- `encrypted_raw_token` and its key version already exist and were never
-- written; the new CHECK says what the code will now guarantee, that only an
-- active code keeps a sealed address. Every existing row satisfies it because
-- the column has always been null.
ALTER TABLE "portal_tokens" ADD COLUMN "issued_by" varchar(255);--> statement-breakpoint
CREATE TABLE "portal_address_downloads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"portal_token_id" uuid NOT NULL,
	"downloaded_by" varchar(255) NOT NULL,
	"purpose" varchar(16) NOT NULL,
	"downloaded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "portal_address_downloads_purpose_valid" CHECK ("portal_address_downloads"."purpose" IN ('download', 'copy'))
);--> statement-breakpoint
ALTER TABLE "portal_address_downloads" ADD CONSTRAINT "portal_address_downloads_token_scope_fk" FOREIGN KEY ("organization_id","property_id","portal_id","portal_token_id") REFERENCES "public"."portal_tokens"("organization_id","property_id","portal_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portal_address_downloads_portal_idx" ON "portal_address_downloads" USING btree ("organization_id","portal_id","downloaded_at");--> statement-breakpoint
ALTER TABLE "portal_tokens" ADD CONSTRAINT "portal_tokens_sealed_address_active_only" CHECK ("portal_tokens"."encrypted_raw_token" IS NULL OR "portal_tokens"."status" = 'active');
