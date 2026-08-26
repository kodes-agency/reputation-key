export type RawRoleDecisionDisposition =
  'central_product_vocabulary' | 'presentation_only' | 'legacy_dark'

export type RawRoleDecisionRow = Readonly<{
  path: string
  disposition: RawRoleDecisionDisposition
  authority: string
}>

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
    path: 'src/contexts/badge/server/badges.ts',
    disposition: 'legacy_dark',
    authority:
      'Retained legacy Badge read logic sits behind the blocked badge.use capability and has no active beta route.',
  },
  {
    path: 'src/contexts/leaderboard/application/use-cases/governed-recognition.ts',
    disposition: 'legacy_dark',
    authority:
      'Retained competitive Recognition code is beta-dark and scheduled for contraction under REC-01.',
  },
  {
    path: 'src/contexts/leaderboard/infrastructure/repositories/recognition.repository.ts',
    disposition: 'legacy_dark',
    authority:
      'Retained competitive Recognition visibility code is beta-dark and scheduled for contraction under REC-01.',
  },
  {
    path: 'src/contexts/team/application/use-cases/team-memberships.ts',
    disposition: 'legacy_dark',
    authority:
      'Retained Team membership logic is quarantined behind team.use; Portal Groups are the supported grouping model.',
  },
] as const satisfies ReadonlyArray<RawRoleDecisionRow>)
