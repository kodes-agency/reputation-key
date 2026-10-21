-- Push health ledger (ADR 0055): how and when each live Review was first seen,
-- and when Google's push for it was accepted.
--
-- Since the skip rule (#909) polling runs about every six hours and Google's
-- push is the fast path for a new Review. Nothing measured whether push
-- worked: a silent outage looked like a quiet week. One row per Review that
-- RepKey first saw as live work (`ongoing`; never a history import or a
-- `legacy_unknown` relink, whose timing RepKey did not observe) records
-- `first_seen_via` (`push`, `push_reconcile`, `snapshot`, and `head` / `demand`
-- for later reads), `first_seen_at`, and `push_accepted_at` (the Pub/Sub
-- acceptance time carried in the push job, NULL until a push is paired with
-- the Review). The Review writer inserts the row in the same transaction as
-- the Review's first insert, so a replayed snapshot page can neither lose nor
-- duplicate it. MISSED / LATE / pending are derived on read from these
-- columns (src/shared/domain/push-health.ts); there is no state table.
--
-- Content-free (ADR 0030/0031): UUIDs, an enum and timestamps. No Review text,
-- reviewer name, provider resource or location id. Operational history like
-- `review_sync_runs`: 30-day retention through the retention sweep, cascade
-- with the Property (the same tenant FK as the reputation snapshot facts), the
-- Organization purge deletes the rows explicitly, and the Organization export
-- does not carry them.
--
-- Purely additive: old web and worker code never names the table. The new code
-- writes it, so this runs before any new process (web's preDeploy; deploy web,
-- then the worker). No backfill: Reviews first seen before this deploy have no
-- row, and measurement starts at the deploy.
--
-- Down: `DROP TABLE review_first_sightings`; delete the 0066 row of
-- drizzle.__drizzle_migrations.
CREATE TABLE "review_first_sightings" (
  "organization_id" varchar(255) NOT NULL,
  "property_id" uuid NOT NULL,
  "review_id" uuid NOT NULL,
  "source_epoch" integer NOT NULL,
  "first_seen_at" timestamp with time zone NOT NULL,
  "first_seen_via" varchar(16) NOT NULL,
  "push_accepted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "review_first_sightings_organization_id_property_id_review_id_pk" PRIMARY KEY("organization_id","property_id","review_id"),
  CONSTRAINT "review_first_sightings_via_valid" CHECK ("first_seen_via" IN ('push', 'push_reconcile', 'snapshot', 'head', 'demand'))
);
--> statement-breakpoint
ALTER TABLE "review_first_sightings" ADD CONSTRAINT "review_first_sightings_property_tenant_fk"
  FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "review_first_sightings_first_seen_idx" ON "review_first_sightings" USING btree ("first_seen_at");
--> statement-breakpoint
CREATE INDEX "review_first_sightings_property_idx" ON "review_first_sightings" USING btree ("property_id","first_seen_at");
