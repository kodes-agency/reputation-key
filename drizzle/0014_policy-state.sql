-- Migration 0014: Policy state (BQC-2.2)
-- Authoritative persistence for authorization policy (ADR 0032/0033, phase BQC-2 §2.2):
-- organization cohort + suspension, per-org non-core capability allowlist,
-- property suspension + allowlist, PropertyAccessGrant with scope/source/lifecycle,
-- generic policy consent, global policy version, and content-free decision audit.
-- Tenant consistency and uniqueness are enforced by explicit constraints
-- (composite FK via properties(organization_id, id), partial unique indexes).

-- Composite unique target for tenant-consistent FKs from policy tables.
CREATE UNIQUE INDEX IF NOT EXISTS "properties_org_id_key" ON "properties" ("organization_id", "id");

CREATE TABLE IF NOT EXISTS "organization_policy" (
  "organization_id" text PRIMARY KEY REFERENCES "organization"("id") ON DELETE CASCADE,
  "cohort" text NOT NULL DEFAULT 'beta',
  "suspended_at" timestamptz,
  "suspended_reason" text,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "organization_capability" (
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "capability" text NOT NULL,
  "created_by" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("organization_id", "capability")
);

CREATE TABLE IF NOT EXISTS "property_policy" (
  "property_id" uuid PRIMARY KEY REFERENCES "properties"("id") ON DELETE CASCADE,
  "suspended_at" timestamptz,
  "suspended_reason" text,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "property_capability" (
  "property_id" uuid NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
  "capability" text NOT NULL,
  "created_by" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("property_id", "capability")
);

CREATE TABLE IF NOT EXISTS "property_access_grant" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" text NOT NULL,
  "property_id" uuid NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "source" text NOT NULL,
  "created_by" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz,
  "revoked_at" timestamptz,
  "revoke_reason" text,
  CONSTRAINT "property_access_grant_tenant_fk"
    FOREIGN KEY ("organization_id", "property_id")
    REFERENCES "properties" ("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "property_access_grant_source_check"
    CHECK ("source" IN ('operator', 'migration', 'invitation'))
);
-- One active grant per (org, property, user); revoked rows keep the audit trail.
CREATE UNIQUE INDEX IF NOT EXISTS "property_access_grant_active_unique"
  ON "property_access_grant" ("organization_id", "property_id", "user_id")
  WHERE "revoked_at" IS NULL;
CREATE INDEX IF NOT EXISTS "property_access_grant_user_idx"
  ON "property_access_grant" ("organization_id", "user_id") WHERE "revoked_at" IS NULL;

CREATE TABLE IF NOT EXISTS "policy_consent" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "subject_type" text NOT NULL,
  "subject_id" text NOT NULL,
  "purpose" text NOT NULL,
  "state" text NOT NULL DEFAULT 'granted',
  "recorded_by" text,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz,
  "revoked_at" timestamptz,
  CONSTRAINT "policy_consent_subject_check"
    CHECK ("subject_type" IN ('organization', 'property', 'user')),
  CONSTRAINT "policy_consent_state_check"
    CHECK ("state" IN ('granted', 'revoked'))
);
-- One active consent per (org, subject, purpose).
CREATE UNIQUE INDEX IF NOT EXISTS "policy_consent_active_unique"
  ON "policy_consent" ("organization_id", "subject_type", "subject_id", "purpose")
  WHERE "state" = 'granted';

-- Content-free decision audit: identifiers, enums, version, correlation only.
-- Deliberately no FK to organization/properties — audit evidence survives
-- tenant deletion (BQC-1.7 rule: purge never deletes audit evidence).
CREATE TABLE IF NOT EXISTS "policy_decision_audit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "occurred_at" timestamptz NOT NULL DEFAULT now(),
  "actor_type" text NOT NULL,
  "actor_id" text,
  "organization_id" text,
  "property_id" uuid,
  "action" text NOT NULL,
  "capability" text,
  "execution_kind" text NOT NULL,
  "decision" text NOT NULL,
  "reason" text NOT NULL,
  "policy_version" text NOT NULL,
  "correlation_id" text,
  CONSTRAINT "policy_decision_audit_actor_check"
    CHECK ("actor_type" IN ('user', 'system', 'operator', 'public')),
  CONSTRAINT "policy_decision_audit_execution_check"
    CHECK ("execution_kind" IN ('interactive', 'worker', 'consumer', 'schedule', 'operator', 'public')),
  CONSTRAINT "policy_decision_audit_decision_check"
    CHECK ("decision" IN ('allow', 'deny'))
);
CREATE INDEX IF NOT EXISTS "policy_decision_audit_org_time_idx"
  ON "policy_decision_audit" ("organization_id", "occurred_at" DESC);

-- Global policy version: bumped (in the same statement) by every policy
-- mutation. The snapshot store polls this version — that is the cache
-- invalidation contract (revocation takes effect within the refresh interval).
CREATE TABLE IF NOT EXISTS "policy_version" (
  "scope" text PRIMARY KEY,
  "version" bigint NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
INSERT INTO "policy_version" ("scope", "version") VALUES ('global', 0)
ON CONFLICT ("scope") DO NOTHING;
