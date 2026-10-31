-- Receipt of an announcement, never consent or an objection window.
CREATE TABLE merchant_ai_notice_update_receipts (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  notice_version varchar(100) NOT NULL,
  notice_digest varchar(64) NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, organization_id, notice_version, notice_digest),
  CONSTRAINT merchant_ai_notice_update_receipts_digest_valid CHECK (notice_digest ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE INDEX merchant_ai_notice_update_receipts_org_idx ON merchant_ai_notice_update_receipts(organization_id);
--> statement-breakpoint
-- The empty sweep visits the enabled-notice index rather than the whole head table.
CREATE INDEX merchant_ai_enablement_enabled_notice_idx ON merchant_ai_enablement(notice_version, notice_digest) WHERE state = 'enabled';
--> statement-breakpoint
CREATE INDEX merchant_ai_consent_evidence_standing_update_idx ON merchant_ai_consent_evidence(organization_id, notice_version, notice_digest, occurred_at DESC) WHERE reason_code = 'standing_renewal';
