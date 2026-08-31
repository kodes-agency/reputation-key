-- Canonical responses created before the staged-feedback timestamp existed may
-- already contain private text. Recover the closest content-write timestamp so
-- those guests receive the same bounded withdrawal contract.
UPDATE "guest_responses"
SET "feedback_submitted_at" = COALESCE(
  "updated_at",
  "corrected_at",
  "submitted_at",
  "created_at"
)
WHERE "response_text" IS NOT NULL
  AND "feedback_submitted_at" IS NULL;
