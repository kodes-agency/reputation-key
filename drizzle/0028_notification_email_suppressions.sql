-- ADR 0046 r.6: a dead address stays dead.
--
-- Until now "the provider refused this recipient" was inferred from queue rows
-- whose provider_state was bounced or complained. Three things were wrong with
-- that. The 90-day retention sweep deletes those rows, so a complainer was
-- mailed again once the evidence aged out. The inference was keyed by user and
-- Organization, so the same dead address kept being mailed from a second
-- Organization. And every bounce counted, so a full mailbox stopped all mail,
-- mandatory notices included, for up to 90 days.
--
-- Suppression is now its own record, keyed by a SHA-256 digest of the
-- normalized address (never the address itself), written only for a permanent
-- bounce, a complaint, or the provider's own suppression, and outside queue
-- retention. It belongs to no Organization: an address is dead for everyone.
CREATE TABLE "notification_email_suppressions" (
  "address_hash" varchar(64) PRIMARY KEY NOT NULL,
  "reason" varchar(24) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notification_email_suppressions_address_hash_valid" CHECK ("notification_email_suppressions"."address_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "notification_email_suppressions_reason_valid" CHECK ("notification_email_suppressions"."reason" IN ('bounced', 'complained', 'suppressed'))
);
--> statement-breakpoint
-- Carry forward the evidence the old inference still has. The bounce type was
-- never stored, so every surviving bounce is kept as the old code treated it:
-- permanent. The address is the recipient's current one, which is the address
-- the app would mail next.
INSERT INTO "notification_email_suppressions" ("address_hash", "reason", "created_at", "updated_at")
SELECT DISTINCT ON (address_hash) address_hash, reason, evidence_at, evidence_at
FROM (
  SELECT
    encode(sha256(convert_to(lower(btrim(u."email")), 'UTF8')), 'hex') AS address_hash,
    CASE
      WHEN q."provider_state" IN ('bounced', 'complained') THEN q."provider_state"
      ELSE 'suppressed'
    END AS reason,
    COALESCE(q."bounced_at", q."updated_at") AS evidence_at
  FROM "notification_email_queue" q
  JOIN "user" u ON u."id" = q."user_id"
  WHERE q."provider_state" IN ('bounced', 'complained')
     OR q."suppression_reason" = 'provider_suppressed'
) AS evidence
ORDER BY address_hash, evidence_at DESC
ON CONFLICT ("address_hash") DO NOTHING;
