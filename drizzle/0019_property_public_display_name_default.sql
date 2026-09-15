-- Give every Property a public display name: the name it already has.
--
-- AI reply drafting refuses a Property without a public display name, and an
-- imported Property never had one: the name lived only in Portal branding and
-- was set by hand. New imports now start it as the confirmed Property name;
-- this fills the same default for the Properties that exist today.
--
-- It never replaces a name someone saved. `updated_by` marks the row as
-- automatic, so the setup wizard keeps asking about it until a person saves a
-- name. Colours start from the palette the branding forms already offer.
-- Properties on their way to purge are left alone.
-- Hand-written data migration; the table model is src/shared/db/schema/portal.schema.ts.
INSERT INTO "property_portal_brand_profiles" (
  "id",
  "organization_id",
  "property_id",
  "display_name",
  "primary_color",
  "background_color",
  "text_color",
  "version",
  "updated_by",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid(),
  p."organization_id",
  p."id",
  btrim(p."name"),
  '#2563EB',
  '#FFFFFF',
  '#111827',
  1,
  'system:public-display-name-default',
  now(),
  now()
FROM "properties" AS p
WHERE p."deleted_at" IS NULL
  AND p."lifecycle_state" IN ('active', 'suspended', 'archived')
  AND char_length(btrim(p."name")) BETWEEN 1 AND 120
ON CONFLICT ("organization_id", "property_id") DO NOTHING;
