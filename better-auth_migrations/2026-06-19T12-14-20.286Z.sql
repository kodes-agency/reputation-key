-- Idempotent: safe to apply after the bootstrap (0000-auth-tables-bootstrap.sql)
-- already created the organization table with these columns.
alter table "organization" add column if not exists "contactEmail" text;

alter table "organization" add column if not exists "billingCompanyName" text;

alter table "organization" add column if not exists "billingAddress" text;

alter table "organization" add column if not exists "billingCity" text;

alter table "organization" add column if not exists "billingPostalCode" text;

alter table "organization" add column if not exists "billingCountry" text;

alter table "organization" add column if not exists "responseSlaHours" integer;
