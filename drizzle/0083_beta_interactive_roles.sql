-- Retain existing Staff/custom login records for explicit support review while
-- revoking their closed-beta tenant authority. The Organization id remains as
-- provenance; state is the fail-closed authority checked on every request.
UPDATE user_organization_bindings AS binding
SET
	state = 'support_resolution',
	version = binding.version + 1,
	resolution_reason = CASE
		WHEN EXISTS (
			SELECT 1
			FROM member
			WHERE member."userId" = binding.user_id
				AND member."organizationId" = binding.organization_id
				AND lower(trim(member.role)) = 'member'
		) THEN 'staff_user_deferred'
		ELSE 'custom_role_disabled_beta'
	END,
	updated_at = NOW()
WHERE binding.state = 'active'
	AND EXISTS (
		SELECT 1
		FROM member
		WHERE member."userId" = binding.user_id
			AND member."organizationId" = binding.organization_id
			AND lower(trim(member.role)) NOT IN ('owner', 'admin')
	);
--> statement-breakpoint
-- A dormant invitation must not later create a login that is outside the
-- frozen beta role contract. No account, membership, or history is deleted.
UPDATE invitation
SET status = 'rejected'
WHERE status = 'pending'
	AND (role IS NULL OR lower(trim(role)) NOT IN ('owner', 'admin'));
