CREATE TABLE "inbox_handling_cycle_heads" (
	"inbox_item_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"current_cycle_number" bigint NOT NULL,
	"current_material_review_revision" bigint NOT NULL,
	"state_revision" bigint DEFAULT 1 NOT NULL,
	"status" "inbox_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_handling_cycle_heads_revisions_safe" CHECK ("inbox_handling_cycle_heads"."current_cycle_number" BETWEEN 1 AND '9007199254740991'::bigint
        AND "inbox_handling_cycle_heads"."current_material_review_revision" BETWEEN 1 AND '9007199254740991'::bigint
        AND "inbox_handling_cycle_heads"."state_revision" BETWEEN 1 AND '9007199254740991'::bigint)
);
--> statement-breakpoint
CREATE TABLE "inbox_handling_cycles" (
	"inbox_item_id" uuid NOT NULL,
	"cycle_number" bigint NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"material_review_revision" bigint NOT NULL,
	"opened_reason" varchar(48) NOT NULL,
	"supersedes_cycle_number" bigint,
	"opened_by" varchar(255),
	"opened_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_handling_cycles_pk" PRIMARY KEY("inbox_item_id","cycle_number"),
	CONSTRAINT "inbox_handling_cycles_sequence_safe" CHECK ("inbox_handling_cycles"."cycle_number" BETWEEN 1 AND '9007199254740991'::bigint
        AND (
          ("inbox_handling_cycles"."cycle_number" = 1 AND "inbox_handling_cycles"."supersedes_cycle_number" IS NULL)
          OR
          ("inbox_handling_cycles"."cycle_number" > 1 AND "inbox_handling_cycles"."supersedes_cycle_number" = "inbox_handling_cycles"."cycle_number" - 1)
        )),
	CONSTRAINT "inbox_handling_cycles_reason_valid" CHECK ("inbox_handling_cycles"."opened_reason" IN (
        'legacy_backfill',
        'review_observed',
        'material_revision_changed',
        'manual_reopen'
      ))
);
--> statement-breakpoint
ALTER TABLE "inbox_handling_cycle_heads" ADD CONSTRAINT "inbox_handling_cycle_heads_inbox_item_id_inbox_items_id_fk" FOREIGN KEY ("inbox_item_id") REFERENCES "public"."inbox_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_handling_cycle_heads" ADD CONSTRAINT "inbox_handling_cycle_heads_current_cycle_fk" FOREIGN KEY ("inbox_item_id","current_cycle_number") REFERENCES "public"."inbox_handling_cycles"("inbox_item_id","cycle_number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_handling_cycle_heads" ADD CONSTRAINT "inbox_handling_cycle_heads_material_revision_fk" FOREIGN KEY ("review_id","current_material_review_revision") REFERENCES "public"."material_review_revisions"("review_id","revision") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_handling_cycles" ADD CONSTRAINT "inbox_handling_cycles_inbox_item_id_inbox_items_id_fk" FOREIGN KEY ("inbox_item_id") REFERENCES "public"."inbox_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_handling_cycles" ADD CONSTRAINT "inbox_handling_cycles_material_revision_fk" FOREIGN KEY ("review_id","material_review_revision") REFERENCES "public"."material_review_revisions"("review_id","revision") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_handling_cycle_heads_scope_idx" ON "inbox_handling_cycle_heads" USING btree ("organization_id","property_id","status");--> statement-breakpoint
CREATE INDEX "inbox_handling_cycles_scope_idx" ON "inbox_handling_cycles" USING btree ("organization_id","property_id","inbox_item_id","cycle_number");--> statement-breakpoint
CREATE INDEX "inbox_handling_cycles_review_revision_idx" ON "inbox_handling_cycles" USING btree ("review_id","material_review_revision","cycle_number");--> statement-breakpoint

-- Expand-only legacy classification. A generic closed_at cannot prove a
-- source-specific handling outcome, so this records only the immutable cycle
-- opening and mirrors the current compatibility status on the head. Orphaned
-- or scope-mismatched rows are deliberately left without a head for the
-- report-first reconciliation step rather than guessing an anchor.
INSERT INTO "inbox_handling_cycles" (
  "inbox_item_id",
  "cycle_number",
  "organization_id",
  "property_id",
  "review_id",
  "material_review_revision",
  "opened_reason",
  "supersedes_cycle_number",
  "opened_by",
  "opened_at",
  "created_at"
)
SELECT
  item."id",
  1,
  item."organization_id",
  review."property_id",
  review."id",
  review."source_revision",
  'legacy_backfill',
  NULL,
  NULL,
  item."created_at",
  item."created_at"
FROM "inbox_items" AS item
JOIN "reviews" AS review
  ON item."source_type" = 'review'
 AND item."source_id" = review."id"
 AND item."organization_id" = review."organization_id"
 AND item."property_id" = review."property_id"::text
JOIN "material_review_revisions" AS revision
  ON revision."review_id" = review."id"
 AND revision."revision" = review."source_revision"
ON CONFLICT ("inbox_item_id", "cycle_number") DO NOTHING;--> statement-breakpoint

INSERT INTO "inbox_handling_cycle_heads" (
  "inbox_item_id",
  "organization_id",
  "property_id",
  "review_id",
  "current_cycle_number",
  "current_material_review_revision",
  "state_revision",
  "status",
  "created_at",
  "updated_at"
)
SELECT
  cycle."inbox_item_id",
  cycle."organization_id",
  cycle."property_id",
  cycle."review_id",
  cycle."cycle_number",
  cycle."material_review_revision",
  1,
  item."status",
  cycle."opened_at",
  item."updated_at"
FROM "inbox_handling_cycles" AS cycle
JOIN "inbox_items" AS item ON item."id" = cycle."inbox_item_id"
WHERE cycle."cycle_number" = 1
  AND cycle."opened_reason" = 'legacy_backfill'
ON CONFLICT ("inbox_item_id") DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "reject_inbox_handling_cycle_update_v1"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'inbox Handling Cycle opening facts are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inbox_handling_cycles_immutable"
BEFORE UPDATE ON "inbox_handling_cycles"
FOR EACH ROW
EXECUTE FUNCTION "reject_inbox_handling_cycle_update_v1"();
