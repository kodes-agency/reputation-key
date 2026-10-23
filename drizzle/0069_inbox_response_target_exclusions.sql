-- Response Targets that must not count: the exclusion ledger (2026-10-23).
--
-- On 2026-10-23 Google restated 62 closed-beta reviews without moving their
-- `updateTime`, and Review minted a Material Review Revision 2 for each (the
-- restatement rule and PR #945 stop that from here on). Inbox opened a Handling Cycle for every
-- one of those revisions, so 55 open items carry a Response Target that was
-- overdue from birth and 7 handled items were reopened and closed again with a
-- completion that counts in the averages. None of those cycles was caused by a
-- guest, so their clocks measure nothing.
--
-- The cycles and targets are immutable history (ADR 0055) and a trigger refuses
-- any rewrite of a completed target, so the rows cannot be edited. This table
-- records, beside the target, that one Handling Cycle is left out of reporting.
-- Analytics, the per-Property overdue figures, reminders and waiting time read
-- it; the organization export marks the row. The target keeps working: a later
-- real reply still closes the cycle, and the completion simply does not count.
--
-- One row is one excluded cycle. The scope foreign key points at the target
-- (through its existing unique index), so the row is deleted with it: an
-- Organization purge deletes items and the cascade reaches this table. Rows are
-- written by `pnpm ops inbox exclude-restated-revision-targets` only, with the
-- operator, the ticket and the harness's correlation id.
--
-- `inbox_response_target_exclusions_append_only_guard` refuses UPDATE, and
-- DELETE unless it is that cascade (the same test the target and reminder
-- guards use: inside a trigger, with the target already gone). The function and
-- the trigger are created here and are not part of `db-constructs.sql`, which
-- `0001_db_constructs.sql` copies byte for byte and runs before this table
-- exists. src/shared/db/schema/db-only-constructs.ts registers them by name and
-- src/shared/db/construct-definitions.ts expects this file's text for them.
--
-- Locks. The table is new and empty, so its foreign key validates nothing; it
-- takes a SHARE ROW EXCLUSIVE lock on `inbox_handling_cycle_response_targets`
-- only for the instant of the ALTER, and the guard function and trigger touch
-- only the new table. migrate-deploy bounds the lock WAIT
-- (src/shared/db/migration-lock-timeout.ts).
--
-- Purely additive. Old code never names the table, so it keeps counting the 62
-- cycles until it is replaced. This runs before any new process (web's
-- preDeploy). No backfill: the operator command records the exclusions after
-- the deploy, dry run first.
--
-- Down: DROP TABLE inbox_response_target_exclusions; DROP FUNCTION
-- enforce_inbox_response_target_exclusion_append_only_v1(); delete the 0069 row
-- of drizzle.__drizzle_migrations.
CREATE TABLE "inbox_response_target_exclusions" (
  "organization_id" varchar(255) NOT NULL,
  "property_id" uuid NOT NULL,
  "inbox_item_id" uuid NOT NULL,
  "cycle_number" bigint NOT NULL,
  "target_kind" varchar(48) NOT NULL,
  "reason" varchar(32) NOT NULL,
  "correlation_id" uuid NOT NULL,
  "operator_id" varchar(255) NOT NULL,
  "ticket" varchar(200),
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "inbox_response_target_exclusions_pk" PRIMARY KEY("inbox_item_id","cycle_number"),
  CONSTRAINT "inbox_response_target_exclusions_values_valid" CHECK ("cycle_number" BETWEEN 1 AND '9007199254740991'::bigint
        AND "reason" = 'provider_restatement'
        AND "target_kind" = 'google_review_response'
        AND char_length(btrim("operator_id")) BETWEEN 1 AND 255
        AND ("ticket" IS NULL OR char_length(btrim("ticket")) BETWEEN 1 AND 200))
);
--> statement-breakpoint
ALTER TABLE "inbox_response_target_exclusions" ADD CONSTRAINT "inbox_response_target_exclusions_target_scope_fk"
  FOREIGN KEY ("inbox_item_id","cycle_number","organization_id","property_id","target_kind") REFERENCES "public"."inbox_handling_cycle_response_targets"("inbox_item_id","cycle_number","organization_id","property_id","target_kind") ON DELETE cascade;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.enforce_inbox_response_target_exclusion_append_only_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1
       AND NOT EXISTS (
         SELECT 1 FROM public.inbox_handling_cycle_response_targets
         WHERE inbox_item_id = OLD.inbox_item_id AND cycle_number = OLD.cycle_number
       ) THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Response Target exclusions are append-only';
END;
$function$
;
--> statement-breakpoint
CREATE TRIGGER inbox_response_target_exclusions_append_only_guard BEFORE DELETE OR UPDATE ON public.inbox_response_target_exclusions FOR EACH ROW EXECUTE FUNCTION enforce_inbox_response_target_exclusion_append_only_v1();
