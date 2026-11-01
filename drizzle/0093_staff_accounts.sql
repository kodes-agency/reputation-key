-- ADR 0076. Staff account foundation stays behind staff.accounts (beta_disabled).
ALTER TABLE portals ADD COLUMN kind varchar(16) NOT NULL DEFAULT 'place';
--> statement-breakpoint
ALTER TABLE portals ADD COLUMN public_name varchar(100);
--> statement-breakpoint
ALTER TABLE portals ADD CONSTRAINT portals_kind_valid CHECK (kind IN ('place', 'personal'));
--> statement-breakpoint
ALTER TABLE portals ADD CONSTRAINT portals_personal_public_name_required CHECK (kind = 'place' OR public_name IS NOT NULL);
--> statement-breakpoint
ALTER TABLE staff_participations ADD COLUMN personal_portal_id uuid;
--> statement-breakpoint
ALTER TABLE staff_participations ADD CONSTRAINT sp_personal_portal_tenant_fk FOREIGN KEY (organization_id, property_id, personal_portal_id) REFERENCES portals (organization_id, property_id, id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX sp_unique_active_personal_portal ON staff_participations (organization_id, property_id, personal_portal_id) WHERE status = 'active' AND personal_portal_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE staff_user_links ADD COLUMN notice_version varchar(64);
--> statement-breakpoint
ALTER TABLE staff_user_links ADD COLUMN notice_acknowledged_at timestamptz;
--> statement-breakpoint
CREATE TABLE staff_onboardings (
  id uuid PRIMARY KEY,
  organization_id varchar(255) NOT NULL,
  property_id uuid NOT NULL,
  email text,
  display_name varchar(100),
  source_portal_id uuid,
  portal_group_id uuid,
  requested_by varchar(255) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'running',
  step text NOT NULL,
  staff_participant_id uuid,
  staff_participation_id uuid,
  portal_id uuid,
  invitation_id text,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_onboardings_property_tenant_fk FOREIGN KEY (organization_id, property_id) REFERENCES properties (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT staff_onboardings_status_valid CHECK (status IN ('running', 'failed', 'done', 'cancelled')),
  CONSTRAINT staff_onboardings_email_lowercase CHECK (email IS NULL OR email = lower(email)),
  CONSTRAINT staff_onboardings_finished_identifiers_only CHECK (status NOT IN ('done', 'cancelled') OR (email IS NULL AND display_name IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX staff_onboardings_unfinished_address ON staff_onboardings (organization_id, property_id, email) WHERE status IN ('running', 'failed');
--> statement-breakpoint
CREATE TABLE staff_property_settings (
  organization_id varchar(255) NOT NULL,
  property_id uuid NOT NULL,
  colleague_list_enabled boolean NOT NULL DEFAULT false,
  updated_by varchar(255) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, property_id),
  CONSTRAINT staff_property_settings_property_tenant_fk FOREIGN KEY (organization_id, property_id) REFERENCES properties (organization_id, id) ON DELETE RESTRICT
);
