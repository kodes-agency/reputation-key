-- Forward-only rolling-deploy compatibility for migration 0089. Older app
-- replicas know only processing_region; derive data_cell_id in PostgreSQL so
-- their inserts/first resolution updates remain visible to cell-scoped readers.
CREATE OR REPLACE FUNCTION guard_property_data_cell_assignment_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.data_cell_id IS NULL
       AND NEW.processing_region IN ('us', 'europe', 'global') THEN
      NEW.data_cell_id := NEW.processing_region;
    ELSIF NEW.data_cell_id IS NOT NULL
       AND NEW.processing_region IS DISTINCT FROM NEW.data_cell_id THEN
      RAISE EXCEPTION 'property data cell assignment conflicts with processing region'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.data_cell_id IS NULL
     AND OLD.data_cell_id IS NULL
     AND NEW.processing_region IN ('us', 'europe', 'global') THEN
    NEW.data_cell_id := NEW.processing_region;
  END IF;

  IF NEW.data_cell_id IS NULL AND OLD.data_cell_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.data_cell_id IS NULL THEN
    RAISE EXCEPTION 'property data cell assignment cannot be cleared'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.processing_region IS DISTINCT FROM NEW.data_cell_id THEN
    RAISE EXCEPTION 'property data cell assignment conflicts with processing region'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.data_cell_id IS NULL OR NEW.data_cell_id IS NOT DISTINCT FROM OLD.data_cell_id THEN
    RETURN NEW;
  END IF;

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

CREATE TRIGGER properties_data_cell_assignment_insert
BEFORE INSERT ON properties
FOR EACH ROW
EXECUTE FUNCTION guard_property_data_cell_assignment_v1();
