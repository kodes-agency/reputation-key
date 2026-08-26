-- Expand phase for the rolling Identity invitation-fact privacy contract.
--
-- The already-published 0105 migration performed a best-effort PostgreSQL
-- scrub. It cannot be rewritten: environments that applied it must advance
-- through this new journal entry. This migration installs the durable
-- cross-version issuance authority; the bounded operator lifecycle handles
-- historical PostgreSQL and Redis copies after the compatible release is
-- running everywhere in a Railway Data Cell.

CREATE TABLE "identity_invitation_fact_contract" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"issuance_version" smallint DEFAULT 1 NOT NULL,
	"generation" bigint DEFAULT 1 NOT NULL,
	"switched_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"operator_id" varchar(255),
	"reason" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_invitation_fact_contract_singleton" CHECK ("identity_invitation_fact_contract"."singleton" = true),
	CONSTRAINT "identity_invitation_fact_contract_version_valid" CHECK ("identity_invitation_fact_contract"."issuance_version" IN (1, 2)),
	CONSTRAINT "identity_invitation_fact_contract_generation_positive" CHECK ("identity_invitation_fact_contract"."generation" >= 1),
	CONSTRAINT "identity_invitation_fact_contract_switch_shape" CHECK (("identity_invitation_fact_contract"."issuance_version" = 1 AND "identity_invitation_fact_contract"."switched_at" IS NULL AND "identity_invitation_fact_contract"."verified_at" IS NULL)
          OR ("identity_invitation_fact_contract"."issuance_version" = 2 AND "identity_invitation_fact_contract"."switched_at" IS NOT NULL)),
	CONSTRAINT "identity_invitation_fact_contract_operator_shape" CHECK (("identity_invitation_fact_contract"."operator_id" IS NULL) = ("identity_invitation_fact_contract"."reason" IS NULL))
);

INSERT INTO "identity_invitation_fact_contract" ("singleton") VALUES (true);

-- The trigger is the cross-version serialization point:
--   * expand/v1: replace any legacy raw address with a structural sentinel so
--     an old v1 parser still accepts the fact without retaining the address;
--   * cutover/v2: clean producers are promoted to v2, while a legacy producer
--     that still supplies a raw address is rejected before its transaction can
--     commit (and therefore before its post-commit activity handler can run).
-- SELECT ... FOR SHARE makes the operator's issuance UPDATE wait for every
-- in-flight fact insert, closing the preDeploy/rolling-replica write race.
CREATE OR REPLACE FUNCTION "guard_identity_invitation_fact_contract_v1"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  active_version smallint;
  supplied_email text;
BEGIN
  IF NEW."event_type" <> 'identity.member.invited' THEN
    RETURN NEW;
  END IF;

  SELECT "issuance_version"
  INTO active_version
  FROM "identity_invitation_fact_contract"
  WHERE "singleton" = true
  FOR SHARE;

  IF active_version IS NULL THEN
    RAISE EXCEPTION 'identity invitation fact contract row is missing';
  END IF;
  IF jsonb_typeof(NEW."payload") <> 'object' THEN
    RAISE EXCEPTION 'identity invitation fact payload must be an object';
  END IF;

  supplied_email := NEW."payload" ->> 'email';
  IF active_version = 1 THEN
    NEW."event_version" := 1;
    NEW."payload" := jsonb_set(
      NEW."payload" - 'email',
      '{email}',
      to_jsonb('[redacted]'::text),
      true
    );
    RETURN NEW;
  END IF;

  IF supplied_email IS NOT NULL AND supplied_email <> '[redacted]' THEN
    RAISE EXCEPTION 'legacy identity invitation fact producer is not permitted after v2 cutover';
  END IF;
  NEW."event_version" := 2;
  NEW."payload" := NEW."payload" - 'email';
  RETURN NEW;
END;
$$;

CREATE TRIGGER "identity_invitation_fact_contract_guard"
BEFORE INSERT OR UPDATE OF "event_type", "event_version", "payload"
ON "outbox_events"
FOR EACH ROW
EXECUTE FUNCTION "guard_identity_invitation_fact_contract_v1"();
