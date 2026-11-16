-- Whether a Portal offers contact requests: the business switches them on per
-- Portal. Purely additive: a column with a constant default rewrites nothing and
-- holds its lock only for the catalogue change. Every existing Portal stays off,
-- and a publication carries the setting only while a Privacy Notice version in
-- force covers contact requests.
ALTER TABLE "portals" ADD COLUMN "contact_requests_enabled" boolean DEFAULT false NOT NULL;
