-- Print codes (ADR 0069), the schema half: the two keyed hashes a short printed
-- address is looked up by.
--
-- A code row (`portal_tokens`) will get one print code per access-artifact channel,
-- a 20-character credential derived from the row's long address and that artifact's
-- id. Only a keyed hash of each is stored: `qr_print_code_hash` for the QR and
-- `nfc_print_code_hash` for the NFC tag. They live here and not on
-- `portal_access_artifacts` because that table is exported and this one is not
-- (Portal CONTEXT, Boundaries): credential material stays out of the export.
--
-- Additive and dark. Both columns are nullable with no default, so an image that
-- inserts a code row without them keeps working through a deploy, and no row is
-- rewritten; a live code's hashes are filled later, when its address is revealed.
-- The CHECKs hold the stored form (64 lowercase hex characters of an
-- HMAC-SHA256), and each unique index is partial, so the many rows with no hash
-- yet are not compared. A hash match is also what says which channel was scanned.
-- `portal_tokens` holds a few rows per Portal and is written only by managers,
-- so the CHECKs' scan and the index builds hold their locks for milliseconds.
ALTER TABLE "portal_tokens" ADD COLUMN "qr_print_code_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "portal_tokens" ADD COLUMN "nfc_print_code_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "portal_tokens" ADD CONSTRAINT "portal_tokens_qr_print_code_hash_format" CHECK ("portal_tokens"."qr_print_code_hash" IS NULL OR "portal_tokens"."qr_print_code_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "portal_tokens" ADD CONSTRAINT "portal_tokens_nfc_print_code_hash_format" CHECK ("portal_tokens"."nfc_print_code_hash" IS NULL OR "portal_tokens"."nfc_print_code_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
CREATE UNIQUE INDEX "portal_tokens_qr_print_code_hash_key" ON "portal_tokens" USING btree ("qr_print_code_hash") WHERE "portal_tokens"."qr_print_code_hash" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "portal_tokens_nfc_print_code_hash_key" ON "portal_tokens" USING btree ("nfc_print_code_hash") WHERE "portal_tokens"."nfc_print_code_hash" IS NOT NULL;
