-- Notification render payload + ADR 0046 r.2 coalescing.
--
-- `notifications.title`/`body` were frozen sentences written at enqueue time,
-- which is why rows shipped raw UUIDs ("Inbox item 61ed98fc-... has been
-- escalated") and could never gain the property name or star rating a manager
-- needs. Copy is now RENDERED from (type, payload) at read time
-- (domain/notification-templates.ts); `payload` is the content-free metadata
-- that render consumes (ADR 0046 r.8 / ADR 0031 / BQC-1.2: property name,
-- rating number, actor ROLE, counts, ages — never review/reply/guest text,
-- media, scores, or another employee's identity). title/body stay as a
-- rendered SNAPSHOT so legacy rows and defensive reads still have a string.
--
-- Uniqueness moves from (user, type, resource, event) to a PARTIAL unique on
-- (user, type, resource) WHERE status = 'unread' (ADR 0046 r.2: "Do not rely
-- on event ID in the uniqueness key"). Under the old key every re-escalation
-- of the same item stacked another unread row; under the new one the single
-- unread row absorbs the repeat and bumps `coalesced_count` /
-- `coalesced_latest_at`.
--
-- Existing rows survive: `payload` is nullable (the mapper reads a missing
-- payload as `{}` and render degrades to the short sentence), and
-- `coalesced_count` defaults to 1. The one hazard is that the OLD key
-- permitted several unread rows per (user, type, resource) — exactly the
-- duplicates this index forbids — so those are collapsed first, retroactively
-- applying r.2: the newest unread row absorbs its siblings' count and latest
-- timestamp, and the siblings are dismissed (hidden, never deleted, matching
-- how Clear-all treats a row the user is done with).
--
-- The same change retires the `digest_summary` CATEGORY. It was a second,
-- redundant expression of the cadence axis — the digest job selects on
-- `cadence = 'daily'` and has never read a category, and the preferences UI
-- already offers immediate|daily per category — and its default policy
-- ({in_app:false, email:false}) is the direct cause of `goal.completed` being
-- dropped whole: for a tenant without explicit preference rows nothing was
-- persisted in-app and nothing was mailed. goal.completed is now
-- `recognition`, and every stored `digest_summary` value is remapped here so
-- no read ever sees a category the code no longer knows. All THREE tables that
-- store one are covered: `notifications` (the in-app rows),
-- `notification_email_queue` (dispatch resolves the recipient's preference
-- from `entry.category`, so a leftover value would fall through to a default
-- policy that no longer knows it and be suppressed as "preference_disabled" —
-- a pending goal email silently dropped instead of sent), and
-- `notification_preferences` (the user's own switches, unique on
-- (user, org, property, category, channel), so a scope that already carries an
-- explicit `recognition` row keeps it and the digest duplicate is deleted
-- rather than colliding). "Daily digest" survives as `cadence = 'daily'` on any
-- category.
--
-- Historical note: 0026 stamped 'digest_summary' onto goal.completed rows. That
-- migration is applied history and must not be edited; this one supersedes it.
ALTER TABLE "notifications" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "coalesced_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "coalesced_latest_at" timestamp with time zone;--> statement-breakpoint
-- 1. The newest unread row per key absorbs its siblings (count + latest).
UPDATE "notifications" AS n
   SET "coalesced_count" = ranked.unread_in_key,
       "coalesced_latest_at" = ranked.latest_in_key,
       "updated_at" = now()
  FROM (
    SELECT
      "id",
      row_number() OVER (
        PARTITION BY "user_id", "type", "resource_id"
        ORDER BY "created_at" DESC, "id" DESC
      ) AS rank_in_key,
      count(*) OVER (PARTITION BY "user_id", "type", "resource_id") AS unread_in_key,
      max("created_at") OVER (PARTITION BY "user_id", "type", "resource_id")
        AS latest_in_key
    FROM "notifications"
    WHERE "status" = 'unread'
  ) AS ranked
 WHERE n."id" = ranked."id"
   AND ranked.rank_in_key = 1
   AND ranked.unread_in_key > 1;--> statement-breakpoint
-- 2. The absorbed siblings are dismissed — hidden, never deleted.
UPDATE "notifications" AS n
   SET "status" = 'dismissed',
       "updated_at" = now()
  FROM (
    SELECT
      "id",
      row_number() OVER (
        PARTITION BY "user_id", "type", "resource_id"
        ORDER BY "created_at" DESC, "id" DESC
      ) AS rank_in_key
    FROM "notifications"
    WHERE "status" = 'unread'
  ) AS ranked
 WHERE n."id" = ranked."id"
   AND ranked.rank_in_key > 1;--> statement-breakpoint
DROP INDEX "notifications_user_event_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_unread_resource_unique" ON "notifications" USING btree ("user_id","type","resource_id") WHERE status = 'unread';--> statement-breakpoint
-- 3. Retire the `digest_summary` category (see the header): in-app rows and
--    queued emails inherit `recognition`, its new home.
UPDATE "notifications" SET "category" = 'recognition', "updated_at" = now()
 WHERE "category" = 'digest_summary';--> statement-breakpoint
UPDATE "notification_email_queue" SET "category" = 'recognition', "updated_at" = now()
 WHERE "category" = 'digest_summary';--> statement-breakpoint
-- 4. Preference rows: an explicit `recognition` row for the same
--    (user, org, property, channel) already states the user's intent, so the
--    digest duplicate is dropped instead of overwriting it.
DELETE FROM "notification_preferences" AS d
 WHERE d."category" = 'digest_summary'
   AND EXISTS (
     SELECT 1
       FROM "notification_preferences" AS r
      WHERE r."user_id" = d."user_id"
        AND r."organization_id" = d."organization_id"
        AND r."property_id" = d."property_id"
        AND r."channel" = d."channel"
        AND r."category" = 'recognition'
   );--> statement-breakpoint
UPDATE "notification_preferences" SET "category" = 'recognition', "updated_at" = now()
 WHERE "category" = 'digest_summary';
