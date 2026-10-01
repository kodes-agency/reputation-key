-- Make what readers show today the stored truth (round 4, slice 44).
--
-- Between migration 0044 and the text-aware editor, code could rename
-- `portal_links.label` and leave the primary-language row of `portal_link_texts`
-- stale. Until now every reader (editor, preview, publish builder, language
-- coverage) showed the newer label for such a link. Slice 44 stops writing the
-- label and lets a stored text always win, so before that rule goes the wording
-- readers showed is copied into the text.
--
-- Data only, and not destructive. It touches a primary-language text only where
-- the link's label is not blank, differs from that text, and was written after
-- it. The text takes the trimmed label, moves its version on, loses its AI-draft
-- provenance (a rename by a person is no draft) and is attributed to the
-- migration. The wording it replaces is kept in the History row, which is
-- written in the same statement with no person (the system made the change)
-- and the instant of the rename. No pending-change fence is opened: the label
-- is what the live page already carries. `portal_links.label` is left as it is,
-- a read-only fallback for a link with no text row.
--
-- Idempotent: once a text equals its label, or is newer than it, the row no
-- longer matches. Environments run the detection SELECT in
-- docs/operations/operator-commands.md before and after.
WITH "stale" AS (
	SELECT t."id" AS "text_id", t."organization_id", t."property_id", t."portal_id", l."id" AS "link_id", t."label" AS "previous_label", btrim(l."label") AS "label", l."updated_at" AS "renamed_at"
	FROM "portal_links" l
	JOIN "portals" p ON p."organization_id" = l."organization_id" AND p."id" = l."portal_id"
	JOIN "portal_link_texts" t ON t."organization_id" = l."organization_id" AND t."link_id" = l."id" AND t."locale" = p."primary_guest_locale"
	WHERE length(btrim(l."label")) > 0 AND btrim(l."label") <> t."label" AND l."updated_at" > t."updated_at"
), "settled" AS (
	UPDATE "portal_link_texts" t
	SET "label" = s."label", "provenance" = NULL, "version" = t."version" + 1, "updated_by" = 'system:migration-0052', "updated_at" = now()
	FROM "stale" s
	WHERE t."id" = s."text_id"
	RETURNING t."id"
)
INSERT INTO "portal_page_edits" ("organization_id", "property_id", "portal_id", "change_kind", "change_key", "previous_text", "new_text", "actor_user_id", "occurred_at")
SELECT s."organization_id", s."property_id", s."portal_id", 'portal_links', 'link:' || s."link_id" || ':updated', s."previous_label", s."label", NULL, s."renamed_at"
FROM "stale" s;
