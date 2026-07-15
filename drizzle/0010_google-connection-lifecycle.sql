-- Migration 0010: Google connection lifecycle + token key versioning (BETA-1 B1.6)
--
-- Expands the connection_status enum from (active, disconnected) to the full
-- lifecycle: pending, active, degraded, reauth_required, disconnecting,
-- disconnected, failed.
--
-- Adds encryption_key_id for versioned token rotation (B1.6 requirement):
-- during key rotation, old-key ciphertext can still be read while new
-- writes use the new key ID.

-- ── Expand connection_status enum ──────────────────────────────────
-- PostgreSQL ADD VALUE must run outside a transaction in some versions.
-- Drizzle migrations run each statement individually for enum additions.
ALTER TYPE connection_status ADD VALUE IF NOT EXISTS 'pending';
ALTER TYPE connection_status ADD VALUE IF NOT EXISTS 'degraded';
ALTER TYPE connection_status ADD VALUE IF NOT EXISTS 'reauth_required';
ALTER TYPE connection_status ADD VALUE IF NOT EXISTS 'disconnecting';
ALTER TYPE connection_status ADD VALUE IF NOT EXISTS 'failed';

-- ── Token encryption key versioning ───────────────────────────────
-- Tracks which encryption key was used for the token ciphertext.
-- During key rotation:
--   1. New tokens are encrypted with the new key (new key_id)
--   2. Old tokens are readable with the old key (dual-key read)
--   3. Background job re-encrypts old tokens with the new key
--   4. Old key is retired after all tokens are re-encrypted
ALTER TABLE google_connections ADD COLUMN IF NOT EXISTS encryption_key_id varchar(50) NOT NULL DEFAULT 'v1';

-- ── Connection health tracking ────────────────────────────────────
-- Last time a sync was successful (for health monitoring)
ALTER TABLE google_connections ADD COLUMN IF NOT EXISTS last_successful_sync_at timestamptz;

-- Reason for the current status (e.g., 'token_revoked', 'rate_limited', 'wrong_account')
ALTER TABLE google_connections ADD COLUMN IF NOT EXISTS status_reason text;

-- When the status was last changed
ALTER TABLE google_connections ADD COLUMN IF NOT EXISTS status_changed_at timestamptz DEFAULT now();

-- Index for finding connections that need attention (reauth, degraded)
CREATE INDEX IF NOT EXISTS google_connections_status_idx
  ON google_connections (status)
  WHERE status NOT IN ('active', 'disconnected');
