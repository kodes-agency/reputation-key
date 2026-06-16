-- Fix missing portal_groups.sort_key column and portal_group_members table.
-- The Drizzle schema was updated to add sort_key and define portal_group_members,
-- but the migrations were never applied to the dev DB. This caused "column does
-- not exist" errors when Drizzle selected all schema columns.

-- 1. Add missing sort_key column to portal_groups
ALTER TABLE portal_groups ADD COLUMN IF NOT EXISTS sort_key varchar(255);

-- 2. Create missing portal_group_members table
CREATE TABLE IF NOT EXISTS portal_group_members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id varchar(255) NOT NULL,
    portal_group_id uuid NOT NULL REFERENCES portal_groups(id) ON DELETE CASCADE,
    portal_id uuid NOT NULL REFERENCES portals(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Unique constraint: a portal can only be in one group per org
CREATE UNIQUE INDEX IF NOT EXISTS portal_group_members_org_portal_unique
    ON portal_group_members(organization_id, portal_id);

-- 4. Index for group lookups
CREATE INDEX IF NOT EXISTS portal_group_members_group_idx
    ON portal_group_members(portal_group_id);
