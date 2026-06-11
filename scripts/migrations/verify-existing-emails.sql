-- Run before enabling requireEmailVerification
-- Marks all existing users as verified so they aren't locked out
UPDATE "user" SET email_verified = true WHERE email_verified IS NULL OR email_verified = false;
