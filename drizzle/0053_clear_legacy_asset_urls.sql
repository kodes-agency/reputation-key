-- Let a picture that never loaded fall back to initials (round 4, slice 47j).
--
-- Until this slice an uploaded avatar or organization logo was stored as an
-- `https://<bucket>.s3.<region>.amazonaws.com/<key>` address. The bucket is
-- private (and, on the beta, not on AWS), so that address never loaded: the UI
-- showed a broken image instead of the person's initials. New uploads are stored
-- as a path on the app (`/api/public/identity-assets/<key>`). The old values
-- point at nothing a browser can read, so they are cleared and the picture is
-- uploaded again.
--
-- Data only. It touches `user.image` and `organization.logo` only where the
-- value is an address on `amazonaws.com`; a picture hosted anywhere else, and
-- every path on the app, is left alone. Idempotent: once cleared, a row no
-- longer matches. Environments run the detection SELECT in
-- docs/operations/operator-commands.md before and after.
UPDATE "user" SET "image" = NULL WHERE "image" ~* '^https?://[^/]*\.amazonaws\.com(:[0-9]+)?/';
--> statement-breakpoint
UPDATE "organization" SET "logo" = NULL WHERE "logo" ~* '^https?://[^/]*\.amazonaws\.com(:[0-9]+)?/';
