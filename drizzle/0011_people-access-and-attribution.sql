-- Migration 0011: People, access, and attribution (POST-BETA-1 PB1.1-PB1.3)
--
-- Per ADR 0039: PropertyAccessGrant, StaffParticipation, TeamMembership,
-- and PortalResponsibility are separate effective-dated concepts.
-- Per ADR 0040: PortalGroupMembership is effective-dated for event-time attribution.
--
-- This migration ADDS new tables alongside the existing staff_assignments.
-- staff_assignments is retired later after migration reconciliation (PB1.4).

-- ── Enums ─────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE grant_status AS ENUM ('active', 'revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE grant_kind AS ENUM ('full_access', 'manage', 'respond', 'view');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE participation_status AS ENUM ('active', 'inactive', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE membership_role AS ENUM ('member', 'lead');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE responsibility_kind AS ENUM ('primary', 'supporting');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Property Access Grants ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS property_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar(255) NOT NULL,
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  user_id varchar(255) NOT NULL,
  kind grant_kind NOT NULL,
  status grant_status NOT NULL DEFAULT 'active',
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  granted_by varchar(255) NOT NULL,
  revoked_by varchar(255),
  reason text
);

CREATE INDEX IF NOT EXISTS pag_org_prop_user_idx
  ON property_access_grants (organization_id, property_id, user_id);

-- One active grant per user/property/kind
CREATE UNIQUE INDEX IF NOT EXISTS pag_unique_active
  ON property_access_grants (organization_id, property_id, user_id, kind)
  WHERE status = 'active';

-- ── Staff Participations ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS staff_participations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar(255) NOT NULL,
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  user_id varchar(255) NOT NULL,
  display_name varchar(255) NOT NULL,
  status participation_status NOT NULL DEFAULT 'active',
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_by varchar(255) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sp_org_prop_user_idx
  ON staff_participations (organization_id, property_id, user_id);

-- One active participation per user/property
CREATE UNIQUE INDEX IF NOT EXISTS sp_unique_active
  ON staff_participations (organization_id, property_id, user_id)
  WHERE status = 'active';

-- ── Team Memberships (effective-dated) ────────────────────────────

CREATE TABLE IF NOT EXISTS team_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar(255) NOT NULL,
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  team_id uuid NOT NULL,
  staff_participation_id uuid NOT NULL REFERENCES staff_participations(id) ON DELETE RESTRICT,
  role membership_role NOT NULL DEFAULT 'member',
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  created_by varchar(255) NOT NULL,
  end_reason text
);

CREATE INDEX IF NOT EXISTS tm_org_team_idx
  ON team_memberships (organization_id, team_id);

CREATE INDEX IF NOT EXISTS tm_org_part_idx
  ON team_memberships (organization_id, staff_participation_id);

-- At most one active lead per team (default)
CREATE UNIQUE INDEX IF NOT EXISTS tm_unique_active_lead
  ON team_memberships (organization_id, team_id)
  WHERE role = 'lead' AND effective_to IS NULL;

-- ── Portal Responsibilities (effective-dated) ─────────────────────

CREATE TABLE IF NOT EXISTS portal_responsibilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar(255) NOT NULL,
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  portal_id uuid NOT NULL REFERENCES portals(id) ON DELETE RESTRICT,
  staff_participation_id uuid NOT NULL REFERENCES staff_participations(id) ON DELETE RESTRICT,
  kind responsibility_kind NOT NULL DEFAULT 'primary',
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  created_by varchar(255) NOT NULL,
  end_reason text
);

CREATE INDEX IF NOT EXISTS pr_org_portal_idx
  ON portal_responsibilities (organization_id, portal_id);

-- At most one active primary per portal
CREATE UNIQUE INDEX IF NOT EXISTS pr_unique_active_primary
  ON portal_responsibilities (organization_id, portal_id)
  WHERE kind = 'primary' AND effective_to IS NULL;

-- ── Portal Group Memberships (effective-dated, event-time) ────────

CREATE TABLE IF NOT EXISTS portal_group_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar(255) NOT NULL,
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  portal_id uuid NOT NULL REFERENCES portals(id) ON DELETE RESTRICT,
  portal_group_id uuid NOT NULL REFERENCES portal_groups(id) ON DELETE RESTRICT,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_by varchar(255) NOT NULL,
  end_reason text
);

CREATE INDEX IF NOT EXISTS pgm_org_portal_idx
  ON portal_group_memberships (organization_id, portal_id);

-- At most one active group per portal
CREATE UNIQUE INDEX IF NOT EXISTS pgm_unique_active
  ON portal_group_memberships (organization_id, portal_id)
  WHERE effective_to IS NULL;
