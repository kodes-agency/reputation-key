-- Add propertyIds to the invitation table.
-- The invitation table is managed by Better Auth (camelCase columns per its
-- defaults); we add the column here via raw SQL the same way other additional
-- fields (org billing*, responseSlaHours) were introduced.
--
-- propertyIds stores a JSON-stringified array of property IDs selected at
-- invite time, consumed by the afterAcceptInvitation hook to create
-- staff_assignments when the invitee joins. Stored as a string (JSON) per the
-- better-auth additionalField config (type: 'string', required: false).
-- Safe to re-run (IF NOT EXISTS).

ALTER TABLE "invitation"
  ADD COLUMN IF NOT EXISTS "propertyIds" text;
