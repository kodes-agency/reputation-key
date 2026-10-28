-- Inbox manager priority (ADR 0071): the level a person sets on an Inbox item.
--
-- A manager can set Urgent, High, Medium or Low on any Review or private
-- feedback item. Inbox stores only that choice: the level, who set it and
-- when. The AI attention level stays a live suggestion read through the AI
-- context and is never copied here, so turning AI off or erasing AI data still
-- removes it at once (ADR 0031).
--
-- `inbox_priority_level` holds the four levels. Three nullable columns on
-- `inbox_items` carry the level in force; `inbox_items_manager_priority_stamped`
-- keeps them all set or all NULL. `inbox_priority_history` is the append-only
-- log of each decision, keyed like `inbox_escalation_history` by the item
-- command revision it produced: a NULL `priority` is a reset, the actor is
-- always a person, and a repeat of the level already set writes no row. It
-- holds no AI level and no free text. Its rows go with their item (ON DELETE
-- CASCADE), so an Organization or Review Property purge removes them.
--
-- No backfill: every existing item starts with no level, which reads as the
-- suggestion or "Not set". Purely additive for old code: it names its columns
-- in every statement, inserts are `onConflictDoNothing`, and nothing upserts
-- `inbox_items`, so it never writes or clears the new columns.
--
-- Locks. The three columns have no default, so adding them changes metadata
-- only (no rewrite). The CHECK is added plain rather than `NOT VALID` and
-- validated later, as 0065 explains for its constraint: drizzle applies every
-- pending file in one transaction, so a NOT VALID/VALIDATE pair would hold the
-- same ACCESS EXCLUSIVE lock over the same scan. Every existing row is NULL in
-- all three columns, so it holds on any data; `inbox_items` holds one row per
-- Review or feedback item, and at beta size the scan is short. The new table
-- is empty, so its foreign key validates nothing and its plain indexes build
-- at once; the foreign key takes a SHARE ROW EXCLUSIVE lock on `inbox_items`
-- only for the instant of the ALTER. migrate-deploy bounds the lock WAIT
-- (src/shared/db/migration-lock-timeout.ts).
--
-- Roll forward, never back. The down step is: DROP TABLE inbox_priority_history;
-- ALTER TABLE inbox_items DROP CONSTRAINT inbox_items_manager_priority_stamped,
-- DROP COLUMN manager_priority, DROP COLUMN manager_priority_set_by, DROP COLUMN
-- manager_priority_set_at; DROP TYPE inbox_priority_level; then delete the 0077
-- row of drizzle.__drizzle_migrations.
CREATE TYPE "public"."inbox_priority_level" AS ENUM('urgent', 'high', 'medium', 'low');--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "manager_priority" "inbox_priority_level";--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "manager_priority_set_by" varchar(255);--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "manager_priority_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_manager_priority_stamped" CHECK (("inbox_items"."manager_priority" IS NULL) = ("inbox_items"."manager_priority_set_by" IS NULL) AND ("inbox_items"."manager_priority" IS NULL) = ("inbox_items"."manager_priority_set_at" IS NULL));--> statement-breakpoint
CREATE TABLE "inbox_priority_history" (
	"inbox_item_id" uuid NOT NULL,
	"resulting_command_revision" bigint NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" varchar(255) NOT NULL,
	"handling_cycle_number" bigint,
	"priority" "inbox_priority_level",
	"previous_priority" "inbox_priority_level",
	"actor_user_id" varchar(255) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_priority_history_pk" PRIMARY KEY("inbox_item_id","resulting_command_revision"),
	CONSTRAINT "inbox_priority_history_revision_safe" CHECK ("inbox_priority_history"."resulting_command_revision" BETWEEN 2 AND '9007199254740991'::bigint
        AND ("inbox_priority_history"."handling_cycle_number" IS NULL OR "inbox_priority_history"."handling_cycle_number" BETWEEN 1 AND '9007199254740991'::bigint)),
	CONSTRAINT "inbox_priority_history_changes_priority" CHECK ("inbox_priority_history"."priority" IS DISTINCT FROM "inbox_priority_history"."previous_priority")
);--> statement-breakpoint
ALTER TABLE "inbox_priority_history" ADD CONSTRAINT "inbox_priority_history_inbox_item_id_inbox_items_id_fk" FOREIGN KEY ("inbox_item_id") REFERENCES "public"."inbox_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_priority_history_scope_idx" ON "inbox_priority_history" USING btree ("organization_id","property_id","occurred_at","inbox_item_id");--> statement-breakpoint
CREATE INDEX "inbox_priority_history_item_idx" ON "inbox_priority_history" USING btree ("inbox_item_id","occurred_at");
