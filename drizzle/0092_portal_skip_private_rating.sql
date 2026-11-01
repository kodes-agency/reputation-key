-- A Portal may skip the private rating when its published Google action is available.
ALTER TABLE portals ADD COLUMN skip_private_rating boolean NOT NULL DEFAULT false;
