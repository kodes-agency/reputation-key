-- ADR 0059: tell a reporter, in the notification bell, that their own beta
-- report was accepted, not planned, or resolved.
--
-- Until now the notification scope rule had two shapes: a mandatory account
-- notice belongs to the Organization, and every other notice belongs to a
-- Property. A beta report belongs to no Property, and "your report was dealt
-- with" is not a mandatory notice — mandatory forces an email that cannot be
-- turned off. So a third shape is admitted, for exactly one type:
-- `beta_feedback.outcome`, category `workflow_collaboration`, no Property, and
-- a resource that is the report itself.
--
-- The type is named in the CHECK on purpose. A general "Organization-scoped
-- non-mandatory" branch would let any future type skip Property scoping
-- without an ADR; naming it keeps each widening a decision.
--
-- The email queue's own scope CHECK is left exactly as it was: there is no
-- preference row that could opt this notice into email, and the application
-- never queues one, so a mailed report outcome is refused twice.
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
    "notifications"."category" <> 'mandatory'
    AND "notifications"."property_id" IS NOT NULL
    AND "notifications"."resource_type" NOT IN ('organization', 'beta_feedback_report')
  )
);
