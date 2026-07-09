-- DAC Stage 2 — permission-version triggers + organizationRole index + last-owner.
-- ADR 0001 / docs/adr/0001-dynamic-access-control.md
--
-- The permission_version + organization_role_policy TABLES are Drizzle-managed
-- (src/shared/db/schema/dac.schema.ts, in drizzle.config tablesFilter) and created
-- by `pnpm db:migrate`. This file holds ONLY what Drizzle cannot express:
--   - a unique index on Better Auth's "organizationRole" table (Drizzle can't own BA DDL), and
--   - triggers / trigger functions / the last-owner backstop (no ORM DSL for CREATE FUNCTION/TRIGGER).
--
-- Apply AFTER `pnpm auth:migrate` AND `pnpm db:migrate` (both tables must exist first):
--   psql "$DATABASE_URL" -f scripts/migrations/2026-07-06-permission-version-triggers.sql
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS). Safe to re-run.
--
-- Casing verified against the live BA tables (\d on Neon, 2026-07-06):
--   member("organizationId","role","userId",...)  organizationRole("organizationId","role",...)
--   staff_assignments(organization_id,...)  invitation("role" NULLABLE, ...)

-- ── 2. Case-insensitive unique index on BA's organizationRole ────────────────
-- BA's own migration ships only non-unique indexes + an app-level count() check,
-- so concurrent / casing-variant role creates (Content-Manager vs content-manager)
-- are not prevented at the DB level. This index closes that gap. Role names are
-- canonicalized (lowercase/trim) before insert by the app-owned service, so
-- lower(role) aligns with organization_role_policy.role (plain text).

CREATE UNIQUE INDEX IF NOT EXISTS organization_role_org_role_lower_unique
  ON "organizationRole" ("organizationId", lower("role"));

-- ── 3. permission_version bump helpers ───────────────────────────────────────

CREATE OR REPLACE FUNCTION bump_permission_version(org_id text) RETURNS void AS $$
BEGIN
  IF org_id IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO permission_version (organization_id, version, updated_at)
  VALUES (org_id, 1, now())
  ON CONFLICT (organization_id) DO UPDATE
    SET version = permission_version.version + 1, updated_at = now();
END;
$$ LANGUAGE plpgsql;

-- AFTER-row trigger fn for BA-owned tables (camelCase "organizationId").
CREATE OR REPLACE FUNCTION tgr_bump_perm_ba() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM bump_permission_version(NEW."organizationId");
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM bump_permission_version(OLD."organizationId");
  ELSIF TG_OP = 'UPDATE' THEN
    -- Org transfer bumps both the source and destination org.
    PERFORM bump_permission_version(NEW."organizationId");
    IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId" THEN
      PERFORM bump_permission_version(OLD."organizationId");
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- AFTER-row trigger fn for app-owned tables (snake_case organization_id).
CREATE OR REPLACE FUNCTION tgr_bump_perm_app() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM bump_permission_version(NEW.organization_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM bump_permission_version(OLD.organization_id);
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM bump_permission_version(NEW.organization_id);
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      PERFORM bump_permission_version(OLD.organization_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ── 4. Version-bump triggers ─────────────────────────────────────────────────
-- member: INSERT / DELETE / UPDATE OF role,organizationId (member has no profile
-- columns, so role + org are the only permission-relevant changes).
DROP TRIGGER IF EXISTS member_perm_ver_ins ON member;
CREATE TRIGGER member_perm_ver_ins AFTER INSERT ON member
  FOR EACH ROW EXECUTE FUNCTION tgr_bump_perm_ba();

DROP TRIGGER IF EXISTS member_perm_ver_del ON member;
CREATE TRIGGER member_perm_ver_del AFTER DELETE ON member
  FOR EACH ROW EXECUTE FUNCTION tgr_bump_perm_ba();

DROP TRIGGER IF EXISTS member_perm_ver_upd ON member;
CREATE TRIGGER member_perm_ver_upd AFTER UPDATE OF "role", "organizationId" ON member
  FOR EACH ROW EXECUTE FUNCTION tgr_bump_perm_ba();

-- organizationRole: any change to a role definition reshapes permissions.
DROP TRIGGER IF EXISTS organization_role_perm_ver_iud ON "organizationRole";
CREATE TRIGGER organization_role_perm_ver_iud
  AFTER INSERT OR UPDATE OR DELETE ON "organizationRole"
  FOR EACH ROW EXECUTE FUNCTION tgr_bump_perm_ba();

-- organization_role_policy: scope changes reshape permissions.
DROP TRIGGER IF EXISTS organization_role_policy_perm_ver_iud ON organization_role_policy;
CREATE TRIGGER organization_role_policy_perm_ver_iud
  AFTER INSERT OR UPDATE OR DELETE ON organization_role_policy
  FOR EACH ROW EXECUTE FUNCTION tgr_bump_perm_app();

-- staff_assignments: assigned-property visibility source (soft-delete via deleted_at
-- is an UPDATE, caught here). Over-invalidates on cosmetic updates — acceptable v1.
DROP TRIGGER IF EXISTS staff_assignments_perm_ver_iud ON staff_assignments;
CREATE TRIGGER staff_assignments_perm_ver_iud
  AFTER INSERT OR UPDATE OR DELETE ON staff_assignments
  FOR EACH ROW EXECUTE FUNCTION tgr_bump_perm_app();

-- ── 5. Last-owner backstop (defense-in-depth for direct-DB writes) ───────────
-- The app guard (withOrgLock + token-aware count, Stage 2 step 7) is the primary
-- enforcement; this BEFORE trigger catches any path that bypasses it. A row counts
-- as an owner when its comma-delimited role contains the 'owner' token, so a
-- multi-role member (owner,content-manager) is protected and demoting/removing it
-- is blocked if it is the org's last owner. Org transfer of the last owner is also
-- blocked (the source org would be left with none).

CREATE OR REPLACE FUNCTION guard_last_owner() RETURNS trigger AS $$
DECLARE
  org_id text;
  remaining_owners int;
BEGIN
  org_id := COALESCE(OLD."organizationId", NEW."organizationId");
  IF org_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- Only restrict when the row currently holds the owner token.
  IF string_to_array(COALESCE(OLD."role", ''), ',') @> ARRAY['owner'] THEN
    SELECT count(*) INTO remaining_owners
    FROM member
    WHERE "organizationId" = org_id
      AND id <> OLD.id
      AND string_to_array("role", ',') @> ARRAY['owner'];
    IF remaining_owners = 0 THEN
      RAISE EXCEPTION 'cannot_remove_last_owner: organization % would have no owner', org_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS member_last_owner_del ON member;
CREATE TRIGGER member_last_owner_del BEFORE DELETE ON member
  FOR EACH ROW EXECUTE FUNCTION guard_last_owner();

-- Fire only on role/org changes (the only changes that can drop an owner).
DROP TRIGGER IF EXISTS member_last_owner_upd ON member;
CREATE TRIGGER member_last_owner_upd BEFORE UPDATE OF "role", "organizationId" ON member
  FOR EACH ROW
  WHEN (OLD."role" IS DISTINCT FROM NEW."role"
        OR OLD."organizationId" IS DISTINCT FROM NEW."organizationId")
  EXECUTE FUNCTION guard_last_owner();
