import type { Capability } from '#/shared/auth/beta-capabilities'

export type RawRoleDecisionDisposition =
  'central_product_vocabulary' | 'presentation_only' | 'legacy_dark'

type RawRoleDecisionBase = Readonly<{
  path: string
  authority: string
}>

type NonAuthorizingRawRoleDecisionRow = RawRoleDecisionBase &
  Readonly<{
    disposition: Exclude<RawRoleDecisionDisposition, 'legacy_dark'>
  }>

export type LegacyDarkRawRoleDecisionRow = RawRoleDecisionBase &
  Readonly<{
    disposition: 'legacy_dark'
    capability: Extract<Capability, 'badge.use' | 'leaderboard.use' | 'team.use'>
    enforcement:
      | 'execution_policy_in_file'
      | 'execution_policy_at_public_seam'
      | 'inert_context_build'
    publicSeam: string
  }>

export type RawRoleDecisionRow =
  NonAuthorizingRawRoleDecisionRow | LegacyDarkRawRoleDecisionRow

/**
 * Exhaustive ownership for direct comparisons against RepKey's built-in role
 * names. Active authorization belongs to permissions/effective authority, not
 * to raw role strings; these retained comparisons have narrower purposes.
 * The paired AST test discovers both missing and stale rows.
 */
export const RAW_ROLE_DECISION_CATALOGUE = Object.freeze([
  {
    path: 'src/shared/domain/beta-interactive-role.ts',
    disposition: 'central_product_vocabulary',
    authority:
      'Closed-beta login vocabulary only; it does not grant a permission or Property scope.',
  },
  {
    path: 'src/shared/domain/roles.ts',
    disposition: 'central_product_vocabulary',
    authority:
      'Canonical Better Auth token mapping and legacy built-in hierarchy; feature authorization uses permissions and effective scope.',
  },
  {
    path: 'src/components/features/identity/member-directory/role-select.tsx',
    disposition: 'presentation_only',
    authority:
      'Selects role-specific form fields after the server-owned membership policy has authorized the mutation.',
  },
  {
    path: 'src/components/features/identity/shared/role-badge.tsx',
    disposition: 'presentation_only',
    authority: 'Maps an already-authorized role value to display copy and styling only.',
  },
  {
    path: 'src/components/features/identity/shared/role-utils.ts',
    disposition: 'presentation_only',
    authority: 'Maps an already-authorized role value to short or full display copy.',
  },
  {
    path: 'src/contexts/team/application/use-cases/team-memberships.ts',
    disposition: 'legacy_dark',
    capability: 'team.use',
    enforcement: 'inert_context_build',
    publicSeam: 'src/contexts/team/build.ts',
    authority:
      'The Team build is inert and production composition has no Team import, so this retained membership source has no tenant-facing or runtime public seam.',
  },
] as const satisfies ReadonlyArray<RawRoleDecisionRow>)
