import type { UserOrganizationBindingState } from './user-organization-binding'

export type UserOrganizationBindingAuditCategory =
  'exact' | 'mappable' | 'conflict' | 'orphan'

export type UserOrganizationBindingAuditSubject = Readonly<{
  membershipOrganizationIds: ReadonlyArray<string>
  binding: Readonly<{
    organizationId: string | null
    state: UserOrganizationBindingState
  }> | null
}>

/**
 * Classify existing identity state without proposing a guessed repair.
 *
 * `mappable` means there is exactly one membership and no binding, so an
 * operator may safely backfill that exact Organization. Every ambiguous or
 * contradictory shape remains `conflict`; missing membership authority is
 * `orphan` even when a stale binding row exists.
 */
export function classifyUserOrganizationBinding(
  subject: UserOrganizationBindingAuditSubject,
): UserOrganizationBindingAuditCategory {
  const organizationIds = [...new Set(subject.membershipOrganizationIds)]
  const binding = subject.binding

  if (organizationIds.length === 0) return 'orphan'
  if (organizationIds.length > 1) return 'conflict'
  if (!binding) return 'mappable'
  if (binding.state !== 'active' || !binding.organizationId) return 'conflict'

  return binding.organizationId === organizationIds[0] ? 'exact' : 'conflict'
}
