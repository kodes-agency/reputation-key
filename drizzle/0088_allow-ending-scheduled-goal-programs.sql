CREATE OR REPLACE FUNCTION guard_goal_program_transition_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."current_version" < OLD."current_version" THEN
    RAISE EXCEPTION 'goal program current_version cannot move backwards'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" <> OLD."status" AND NOT (
    (OLD."status" = 'scheduled' AND NEW."status" IN ('active', 'ended'))
    OR (OLD."status" = 'active' AND NEW."status" IN ('paused', 'ended'))
    OR (OLD."status" = 'paused' AND NEW."status" IN ('active', 'ended'))
  ) THEN
    RAISE EXCEPTION 'invalid goal program transition: % -> %', OLD."status", NEW."status"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
