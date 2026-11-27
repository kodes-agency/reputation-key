-- migrate:contract 561626a5749965b7c819a148b51a0d4edfe5b4ee
-- Drops the retired notification category defaults table. The person's default
-- for a category and channel is a Property-less row of notification_preferences,
-- and nothing reads the table (since #2416), writes it (since #2435) or copies
-- into it (since #2569). Nothing references it; its CHECKs, its unique index and
-- its primary key go with it.
DROP TABLE IF EXISTS "notification_category_defaults";
