CREATE FUNCTION "guard_portal_publication_history_v1"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'portal_publication_snapshots' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'portal publication snapshots are immutable';
  END IF;

  IF OLD.deactivated_at IS NOT NULL
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.property_id IS DISTINCT FROM OLD.property_id
     OR NEW.portal_id IS DISTINCT FROM OLD.portal_id
     OR NEW.snapshot_id IS DISTINCT FROM OLD.snapshot_id
     OR NEW.activation_sequence IS DISTINCT FROM OLD.activation_sequence
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.activated_by IS DISTINCT FROM OLD.activated_by
     OR NEW.activated_at IS DISTINCT FROM OLD.activated_at
     OR NEW.deactivated_at IS NULL
     OR NEW.deactivation_reason IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'portal publication activation history is append-only';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "portal_publication_snapshots_immutable"
BEFORE UPDATE ON "portal_publication_snapshots"
FOR EACH ROW EXECUTE FUNCTION "guard_portal_publication_history_v1"();--> statement-breakpoint
CREATE TRIGGER "portal_publication_activations_history_guard"
BEFORE UPDATE ON "portal_publication_activations"
FOR EACH ROW EXECUTE FUNCTION "guard_portal_publication_history_v1"();
