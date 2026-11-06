-- migrate:contract 470f4558fb9a0bda5e59678533b261f22f730f41
-- Existing writers already obey these guards. The preflight still requires
-- their release on both services before tightening replica-session enforcement.
ALTER TABLE public.backup_erasure_ledger
  ENABLE ALWAYS TRIGGER backup_erasure_ledger_update_delete_guard;
--> statement-breakpoint
ALTER TABLE public.backup_erasure_ledger
  ENABLE ALWAYS TRIGGER backup_erasure_ledger_truncate_guard;
--> statement-breakpoint
ALTER TABLE public.property_erase_authorities
  ENABLE ALWAYS TRIGGER property_erase_authorities_transition_guard;
