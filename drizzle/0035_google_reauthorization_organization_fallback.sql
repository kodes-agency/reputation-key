-- ADR 0046: `integration.reauthorization_required` anchors on one of the
-- Organization's active Properties, because it is urgent_operational mail and
-- the email queue's scope CHECK demands a Property.
--
-- Google can need reconnecting before any Property is active: between
-- connecting Google and the first successful import (the first time a token
-- is used), or with every Property archived. The notice then had no anchor
-- and reached nobody. It now falls back to the Organization, in the bell
-- only, pointing at the connection, the shape `integration.google_disconnected`
-- already has.
--
-- A fifth shape is admitted, for exactly this type: category
-- `urgent_operational`, no Property, `integration` as the resource. The
-- Property-scoped branch is unchanged and still admits the anchored notice.
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_mandatory_scope_check";
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_mandatory_scope_check" CHECK (
  (
    "notifications"."category" = 'mandatory'
    AND "notifications"."property_id" IS NULL
    AND "notifications"."resource_type" = 'organization'
  ) OR (
    "notifications"."type" = 'beta_feedback.outcome'
    AND "notifications"."category" = 'workflow_collaboration'
    AND "notifications"."property_id" IS NULL
    AND "notifications"."resource_type" = 'beta_feedback_report'
  ) OR (
    "notifications"."type" = 'integration.google_disconnected'
    AND "notifications"."category" = 'workflow_collaboration'
    AND "notifications"."property_id" IS NULL
    AND "notifications"."resource_type" = 'integration'
  ) OR (
    "notifications"."type" = 'integration.reauthorization_required'
    AND "notifications"."category" = 'urgent_operational'
    AND "notifications"."property_id" IS NULL
    AND "notifications"."resource_type" = 'integration'
  ) OR (
    "notifications"."category" <> 'mandatory'
    AND "notifications"."property_id" IS NOT NULL
    AND "notifications"."resource_type" NOT IN ('organization', 'beta_feedback_report')
  )
);
