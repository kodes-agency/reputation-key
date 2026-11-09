-- migrate:contract 556b03515febb43440b1d55c24065b9da655736b
-- Additive. A preference row with no Property is the person's answer for one
-- (category, channel) in an Organization: what a Property without a row of its
-- own inherits. The existing unique index keeps serving per-Property rows; a
-- partial one covers the rows with no Property. No data moves here, and the
-- category defaults table is untouched.
ALTER TABLE "notification_preferences" ALTER COLUMN "property_id" DROP NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_prefs_default_scope_unique" ON "notification_preferences" USING btree ("user_id","organization_id","category","channel") WHERE "notification_preferences"."property_id" IS NULL;
