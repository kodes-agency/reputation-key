-- Portal page-edit ledger (round 4, slice 35b).
--
-- Purely additive. `portal_page_edits` records who changed which part of a
-- Portal's page and when, written in the same transaction as the working-copy
-- write and the pending-change fence. The key names the part of the page and
-- the verb (identifiers, locales and settings fields only); a single wording
-- change also keeps the text before and after, bounded to 200 characters, and
-- only where the key says wording changed (never a look, an order or a
-- destination). Saves of the same part by the same person with no publication
-- between them fold into one row: `occurred_at` moves to the latest save and
-- `edit_count` counts them. `portal_id` is null for the Property's look and
-- welcome text, which belong to every Portal in the Property (the composite
-- foreign key does not apply to a row with a null column, so a second tenant
-- foreign key ties those rows to their Property). History starts at the
-- deploy: earlier edits were never attributed, so none is reconstructed.
CREATE TABLE "portal_page_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid,
	"change_kind" varchar(40) NOT NULL,
	"change_key" varchar(160) DEFAULT 'all' NOT NULL,
	"previous_text" varchar(200),
	"new_text" varchar(200),
	"edit_count" integer DEFAULT 1 NOT NULL,
	"actor_user_id" varchar(255),
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_page_edits_kind_valid" CHECK ("portal_page_edits"."change_kind" IN ('portal_configuration', 'portal_links', 'property_brand_profile', 'property_brand_content', 'portal_localized_override', 'approved_destination')),
	CONSTRAINT "portal_page_edits_scope" CHECK (("portal_page_edits"."change_kind" IN ('property_brand_profile', 'property_brand_content')) = ("portal_page_edits"."portal_id" IS NULL)),
	CONSTRAINT "portal_page_edits_count_positive" CHECK ("portal_page_edits"."edit_count" >= 1),
	CONSTRAINT "portal_page_edits_text_scope" CHECK (("portal_page_edits"."previous_text" IS NULL AND "portal_page_edits"."new_text" IS NULL) OR "portal_page_edits"."change_kind" IN ('property_brand_content', 'portal_localized_override') OR ("portal_page_edits"."change_kind" = 'property_brand_profile' AND "portal_page_edits"."change_key" = 'all') OR ("portal_page_edits"."change_kind" = 'portal_links' AND "portal_page_edits"."change_key" !~~ '%reordered' AND "portal_page_edits"."change_key" <> 'linktree:enabled') OR ("portal_page_edits"."change_kind" = 'portal_configuration' AND "portal_page_edits"."change_key" IN ('settings:name', 'settings:description')))
);--> statement-breakpoint
ALTER TABLE "portal_page_edits" ADD CONSTRAINT "portal_page_edits_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_page_edits" ADD CONSTRAINT "portal_page_edits_portal_tenant_fk" FOREIGN KEY ("organization_id","property_id","portal_id") REFERENCES "public"."portals"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portal_page_edits_property_portal_idx" ON "portal_page_edits" USING btree ("organization_id","property_id","portal_id","occurred_at");
