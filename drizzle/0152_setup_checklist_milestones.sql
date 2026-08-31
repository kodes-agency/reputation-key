CREATE TABLE "setup_checklist_milestones" (
	"organization_id" varchar(255) NOT NULL,
	"step" varchar(40) NOT NULL,
	"first_completed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "setup_checklist_milestones_pk" PRIMARY KEY("organization_id","step"),
	CONSTRAINT "setup_checklist_milestones_step_valid" CHECK ("setup_checklist_milestones"."step" IN ('google_connection', 'imported_property', 'initial_review_sync', 'published_portal', 'responsible_managers'))
);
