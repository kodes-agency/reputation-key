import { createHash } from 'node:crypto'

export const PORTAL_BETA_READINESS_REPORT_VERSION =
  'repkey-portal-beta-readiness-reconciliation-1' as const

export const PORTAL_BETA_READINESS_REASON_CODES = [
  'creator_provenance_unknown',
  'legacy_polymorphic_owner_unreconciled',
  'multiple_active_group_memberships',
  'legacy_group_scope_invalid',
  'legacy_group_membership_unreconciled',
  'legacy_and_effective_group_disagree',
  'active_group_scope_invalid',
  'resolvable_token_missing_access_artifact',
  'print_batch_token_requires_replacement',
  'multiple_active_portal_tokens',
  'property_brand_profile_missing',
  'legacy_theme_requires_brand_classification',
  'legacy_hero_requires_localized_classification',
  'primary_locale_content_incomplete',
  'additional_locale_content_incomplete',
  'raw_secondary_link_unclassified',
  'raw_secondary_link_quarantined',
] as const

export type PortalBetaReadinessReasonCode =
  (typeof PORTAL_BETA_READINESS_REASON_CODES)[number]

export type PortalBetaReadinessGap = Readonly<{
  organizationId: string
  propertyId: string
  portalId: string
  sourceId: string
  reasonCode: PortalBetaReadinessReasonCode
  relatedIds: readonly string[]
}>

export type PortalBetaReadinessReport = Readonly<{
  schemaVersion: typeof PORTAL_BETA_READINESS_REPORT_VERSION
  asOf: string
  scope: Readonly<{
    kind: 'global' | 'organizations'
    organizationIds: readonly string[]
  }>
  ready: boolean
  counts: Readonly<{
    gapCount: number
    portalCount: number
    byReason: Readonly<Record<PortalBetaReadinessReasonCode, number>>
  }>
  gaps: readonly PortalBetaReadinessGap[]
  fingerprintSha256: string
}>

const gapKey = (gap: PortalBetaReadinessGap): string =>
  [gap.organizationId, gap.portalId, gap.sourceId, gap.reasonCode].join('\u0000')

const CONTENT_FREE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/

function assertIdentifierOnly(value: string, field: string): void {
  if (!CONTENT_FREE_IDENTIFIER.test(value)) {
    throw new Error(`${field} must be an identifier-only value`)
  }
}

function stableGaps(
  gaps: readonly PortalBetaReadinessGap[],
): readonly PortalBetaReadinessGap[] {
  const normalized = gaps
    .map((gap) => {
      assertIdentifierOnly(gap.organizationId, 'organizationId')
      assertIdentifierOnly(gap.propertyId, 'propertyId')
      assertIdentifierOnly(gap.portalId, 'portalId')
      assertIdentifierOnly(gap.sourceId, 'sourceId')
      for (const relatedId of gap.relatedIds) {
        assertIdentifierOnly(relatedId, 'relatedId')
      }
      return { ...gap, relatedIds: [...new Set(gap.relatedIds)].sort() }
    })
    .sort((left, right) => {
      const leftKey = gapKey(left)
      const rightKey = gapKey(right)
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
    })
  const seen = new Set<string>()
  for (const gap of normalized) {
    const key = gapKey(gap)
    if (seen.has(key)) throw new Error(`duplicate Portal readiness gap: ${key}`)
    seen.add(key)
  }
  return normalized
}

function countByReason(
  gaps: readonly PortalBetaReadinessGap[],
): Record<PortalBetaReadinessReasonCode, number> {
  const counts = Object.fromEntries(
    PORTAL_BETA_READINESS_REASON_CODES.map((reasonCode) => [reasonCode, 0]),
  ) as Record<PortalBetaReadinessReasonCode, number>
  for (const gap of gaps) counts[gap.reasonCode] += 1
  return counts
}

export function buildPortalBetaReadinessReport(input: {
  readonly asOf: Date
  readonly organizationIds?: readonly string[]
  readonly gaps: readonly PortalBetaReadinessGap[]
}): PortalBetaReadinessReport {
  if (Number.isNaN(input.asOf.getTime())) throw new Error('invalid report cutoff')
  const organizationIds = [...new Set(input.organizationIds ?? [])].sort()
  for (const organizationId of organizationIds) {
    assertIdentifierOnly(organizationId, 'scope organizationId')
  }
  const gaps = stableGaps(input.gaps)
  const payload = {
    schemaVersion: PORTAL_BETA_READINESS_REPORT_VERSION,
    asOf: input.asOf.toISOString(),
    scope:
      organizationIds.length === 0
        ? ({ kind: 'global', organizationIds } as const)
        : ({ kind: 'organizations', organizationIds } as const),
    ready: gaps.length === 0,
    counts: {
      gapCount: gaps.length,
      portalCount: new Set(
        gaps.map((gap) => `${gap.organizationId}\u0000${gap.portalId}`),
      ).size,
      byReason: countByReason(gaps),
    },
    gaps,
  }
  const fingerprintSha256 = createHash('sha256')
    .update(JSON.stringify(payload), 'utf8')
    .digest('hex')
  return { ...payload, fingerprintSha256 }
}

export function canonicalPortalBetaReadinessReport(
  report: PortalBetaReadinessReport,
): string {
  return `${JSON.stringify(report, null, 2)}\n`
}
