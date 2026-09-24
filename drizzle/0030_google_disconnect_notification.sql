-- ADR 0046 (amended 2026-09-24): tell the other AccountAdmins, in the
-- notification bell, that somebody deliberately disconnected the
-- Organization's Google account.
--
-- The Google connection belongs to the Organization, not to a Property. The
-- existing `integration.reauthorization_required` notice works around that by
-- anchoring itself on an arbitrary Property, because it is urgent_operational
-- and therefore mailed, and the email queue's scope CHECK demands a Property.
-- This notice is in-app only (`workflow_collaboration`, Organization-scoped,
-- no preference row can opt it into email), so it can be scoped to what it is
-- actually about: the connection.
--
-- A fourth shape is therefore admitted, for exactly one more type:
-- `integration.google_disconnected`, category `workflow_collaboration`, no
-- Property, and `integration` as the resource. The Property-scoped branch is
-- unchanged and still admits `integration` WITH a Property, which is what
-- `integration.reauthorization_required` writes.
--
-- The type is named in the CHECK, as ADR 0059 named the first one. A general
-- "Organization-scoped non-mandatory" branch would let any future type skip
-- Property scoping without an ADR; naming it keeps each widening a decision.
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
    "notifications"."category" <> 'mandatory'
    AND "notifications"."property_id" IS NOT NULL
    AND "notifications"."resource_type" NOT IN ('organization', 'beta_feedback_report')
  )
);
