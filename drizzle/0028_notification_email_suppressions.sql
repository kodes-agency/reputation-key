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
-- Suppression is now its own record, keyed by an HMAC-SHA-256 of the
-- normalized address under a server secret (never the address itself, and no
-- bare digest a list of addresses could reverse), written only for a
-- permanent bounce, a complaint, or the provider's own suppression, and
-- outside queue retention. It belongs to no Organization: an address is dead
-- for everyone.
--
-- Nothing is backfilled. The key needs the server secret, which the database
-- never holds, and the old evidence cannot tell a permanent bounce from a full
-- mailbox. The provider keeps its own suppression list: the next send to an
-- address on it is refused, and its `email.suppressed` event records the
-- address here.
CREATE TABLE "notification_email_suppressions" (
  "address_hash" varchar(64) PRIMARY KEY NOT NULL,
  "reason" varchar(24) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notification_email_suppressions_address_hash_valid" CHECK ("notification_email_suppressions"."address_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "notification_email_suppressions_reason_valid" CHECK ("notification_email_suppressions"."reason" IN ('bounced', 'complained', 'suppressed'))
);
