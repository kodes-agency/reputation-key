ALTER TABLE "properties" ADD COLUMN "data_cell_id" text;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_data_cell_id_valid" CHECK ("properties"."data_cell_id" IS NULL OR "properties"."data_cell_id" IN ('us', 'europe', 'global'));--> statement-breakpoint

-- Expand/backfill: old application versions may continue to write the legacy
-- column while the new version dual-writes. Only known assignments backfill;
-- unresolved/invalid rows remain NULL and fail closed for operator review.
UPDATE "properties"
SET "data_cell_id" = "processing_region"
WHERE "data_cell_id" IS NULL
  AND "processing_region" IN ('us', 'europe', 'global');--> statement-breakpoint

CREATE OR REPLACE FUNCTION guard_property_data_cell_assignment_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Pre-assignment legacy rows remain mutable during the expand rollout.
  IF NEW.data_cell_id IS NULL AND OLD.data_cell_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.data_cell_id IS NULL THEN
    RAISE EXCEPTION 'property data cell assignment cannot be cleared'
      USING ERRCODE = '23514';
  END IF;

  -- Once assigned, the compatibility column must describe the same cell.
  IF NEW.processing_region IS DISTINCT FROM NEW.data_cell_id THEN
    RAISE EXCEPTION 'property data cell assignment conflicts with processing region'
      USING ERRCODE = '23514';
  END IF;

  -- One-way initial assignment is allowed; ordinary updates may retain it.
  IF OLD.data_cell_id IS NULL OR NEW.data_cell_id IS NOT DISTINCT FROM OLD.data_cell_id THEN
    RETURN NEW;
  END IF;

  -- The only reassignment authority is an operator move at the exact state
  -- where its target activation or rollback effect executes.
  IF EXISTS (
    SELECT 1
    FROM region_moves move
    WHERE move.property_id = OLD.id
      AND move.organization_id = OLD.organization_id
      AND (
        (move.state = 'verified'
          AND move.from_region = OLD.data_cell_id
          AND move.to_region = NEW.data_cell_id)
        OR
        (move.state = 'failed'
          AND move.to_region = OLD.data_cell_id
          AND move.from_region = NEW.data_cell_id)
      )
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'property data cell assignment is immutable outside an operator move'
    USING ERRCODE = '23514';
END;
$$;--> statement-breakpoint

CREATE TRIGGER properties_data_cell_assignment_guard
BEFORE UPDATE OF data_cell_id, processing_region ON properties
FOR EACH ROW
EXECUTE FUNCTION guard_property_data_cell_assignment_v1();
