-- Invitation facts identify the invitation and requested role; the invitee
-- email remains only in the Identity-owned invitation record. Remove copies
-- written before the identifier-only contract was enforced.

UPDATE "outbox_events"
SET "payload" = "payload" - 'email'
WHERE "event_type" = 'identity.member.invited'
  AND "payload" ? 'email';

UPDATE "activity_log"
SET "payload" = jsonb_set("payload", '{detail}', 'null'::jsonb, true)
WHERE "action" = 'invited'
  AND "resource_type" = 'member'
  AND "payload" ->> 'detail' IS NOT NULL;
