-- Add response_sla_hours to the organization table.
-- The organization table is managed by Better Auth (camelCase columns per its
-- defaults); we add the column here via raw SQL the same way other org fields
-- (billing*, contactEmail) were introduced.
--
-- responseSlaHours feeds the dashboard "attention band" signal #1:
-- unanswered reviews past the response SLA. Default 48 hours.
-- Safe to re-run (IF NOT EXISTS).

ALTER TABLE "organization"
  ADD COLUMN IF NOT EXISTS "responseSlaHours" integer NOT NULL DEFAULT 48;
