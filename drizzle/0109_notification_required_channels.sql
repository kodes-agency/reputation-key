-- Required channels cannot be opted out. Normalize stale expand-phase rows
-- before adding the database boundary so rollout is upgrade-safe.
UPDATE "notification_preferences"
SET "enabled" = true,
    "updated_at" = now()
WHERE "enabled" = false
  AND (
    "category" = 'mandatory'
    OR ("category" = 'urgent_operational' AND "channel" = 'in_app')
  );
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_required_enabled" CHECK ("notification_preferences"."enabled" OR (
        "notification_preferences"."category" <> 'mandatory'
        AND NOT ("notification_preferences"."category" = 'urgent_operational' AND "notification_preferences"."channel" = 'in_app')
      ));
