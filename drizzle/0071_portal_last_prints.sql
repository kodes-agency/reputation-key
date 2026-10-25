-- The last final print, remembered per Portal (final print kit, build slice 12).
--
-- Purely additive. `portal_last_prints` holds one row per Portal: the choices of
-- the Portal's last final print (piece, orientation, look, paper, who prints, how
-- many, the languages and the call to action) and, for an Immersive print, the
-- photo it used by image and framing. Share reads it to say when the Portal was
-- last printed, to set the same choices again and to say the photo has changed
-- since. The next print replaces the row; a Portal that was never printed has
-- none, and earlier prints are not reconstructed. It holds choices and a day
-- only: never the address, a print code or a file. The photo has no foreign key,
-- so taking an image down never waits on a remembered print.
--
-- The table is new and empty and is written once per download, so its CHECKs and
-- its foreign key lock nothing that is in use.
CREATE TABLE "portal_last_prints" (
	"portal_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"piece" varchar(16) NOT NULL,
	"orientation" varchar(16) NOT NULL,
	"look" varchar(16) NOT NULL,
	"paper" varchar(16) NOT NULL,
	"printer" varchar(16) NOT NULL,
	"quantity" integer NOT NULL,
	"fill_spares" boolean NOT NULL,
	"per_sheet" integer,
	"crop_marks" boolean NOT NULL,
	"back_page" boolean NOT NULL,
	"languages" jsonb NOT NULL,
	"call_to_action" varchar(16) NOT NULL,
	"photo_asset_id" uuid,
	"photo_focal_x" double precision,
	"photo_focal_y" double precision,
	"printed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "portal_last_prints_piece_valid" CHECK ("portal_last_prints"."piece" IN ('counter', 'tent', 'small')),
	CONSTRAINT "portal_last_prints_orientation_valid" CHECK ("portal_last_prints"."orientation" IN ('upright', 'wide')),
	CONSTRAINT "portal_last_prints_look_valid" CHECK ("portal_last_prints"."look" IN ('paper', 'immersive')),
	CONSTRAINT "portal_last_prints_paper_valid" CHECK ("portal_last_prints"."paper" IN ('letter', 'a4')),
	CONSTRAINT "portal_last_prints_printer_valid" CHECK ("portal_last_prints"."printer" IN ('my_printer', 'print_shop')),
	CONSTRAINT "portal_last_prints_call_to_action_valid" CHECK ("portal_last_prints"."call_to_action" IN ('rate', 'tell')),
	CONSTRAINT "portal_last_prints_quantity_valid" CHECK ("portal_last_prints"."quantity" BETWEEN 1 AND 1000),
	CONSTRAINT "portal_last_prints_per_sheet_valid" CHECK ("portal_last_prints"."per_sheet" IS NULL OR "portal_last_prints"."per_sheet" >= 1),
	CONSTRAINT "portal_last_prints_languages_valid" CHECK (jsonb_typeof("portal_last_prints"."languages") = 'array' AND jsonb_array_length("portal_last_prints"."languages") BETWEEN 1 AND 2),
	CONSTRAINT "portal_last_prints_photo_whole" CHECK (("portal_last_prints"."photo_asset_id" IS NULL) = ("portal_last_prints"."photo_focal_x" IS NULL) AND ("portal_last_prints"."photo_asset_id" IS NULL) = ("portal_last_prints"."photo_focal_y" IS NULL))
);--> statement-breakpoint
ALTER TABLE "portal_last_prints" ADD CONSTRAINT "portal_last_prints_portal_tenant_fk" FOREIGN KEY ("organization_id","property_id","portal_id") REFERENCES "public"."portals"("organization_id","property_id","id") ON DELETE cascade ON UPDATE no action;
