import { describe, expect, it } from 'vitest'
import {
  dashboardKeys,
  goalKeys,
  identityKeys,
  integrationKeys,
  portalKeys,
  propertyKeys,
} from './query-keys'

describe('identity query keys', () => {
  it('keeps the organization AI overview beside, not inside, per-property consent snapshots', () => {
    expect(identityKeys.merchantAiOverview()).toEqual([
      'identity',
      'merchant-ai-overview',
    ])
    expect(identityKeys.merchantAiAuthorization('property-1').slice(0, 2)).not.toEqual(
      identityKeys.merchantAiOverview(),
    )
  })

  it('keeps personal and organization invitation response shapes disjoint', () => {
    const personal = identityKeys.userInvitations()
    const organization = identityKeys.organizationInvitations()

    expect(personal).not.toEqual(organization)
    expect(personal.slice(0, -1)).toEqual(identityKeys.invitations())
    expect(organization.slice(0, -1)).toEqual(identityKeys.invitations())
  })
})

describe('property setup query keys', () => {
  it('nests one Property setup under its detail and the summaries under the list', () => {
    expect(propertyKeys.setup('property-1')).toEqual([
      'properties',
      'detail',
      'property-1',
      'setup',
    ])
    expect(propertyKeys.setup('property-1').slice(0, -1)).toEqual(
      propertyKeys.detail('property-1'),
    )
    expect(propertyKeys.setupSummaries()).toEqual([
      'properties',
      'list',
      'setup-summaries',
    ])
    expect(propertyKeys.setupSummaries().slice(0, -1)).toEqual(propertyKeys.list())
  })
})

describe('volatile provider query keys', () => {
  it('isolates imported provider content by view epoch and lease', () => {
    expect(integrationKeys.googleImportAccounts('org-1', 'connection-1', 4)).toEqual([
      'integrations',
      'google-import-content',
      'org-1',
      'connection-1',
      'accounts',
      4,
    ])
    expect(
      integrationKeys.googleImportCandidates('org-1', 'connection-1', 'account-1', 4),
    ).toEqual([
      'integrations',
      'google-import-content',
      'org-1',
      'connection-1',
      'candidates',
      'account-1',
      4,
    ])
    expect(
      integrationKeys.googleImportLease('org-1', 'connection-1', 'lease-1', 4),
    ).toEqual([
      'integrations',
      'google-import-content',
      'org-1',
      'connection-1',
      'lease',
      'lease-1',
      4,
    ])
  })

  it('isolates performance authorization leases by report and lease identity', () => {
    expect(
      dashboardKeys.googlePerformanceLease(
        'property-1',
        'last_30_days',
        'catalog-v1',
        3,
        'lease-1',
      ),
    ).toEqual([
      'dashboard',
      'google-performance',
      'property-1',
      'last_30_days',
      'catalog-v1',
      3,
      'authorization-lease',
      'lease-1',
    ])
  })
})

describe('dashboard query keys', () => {
  it('provides a real fleet prefix above range-specific cache entries', () => {
    expect(dashboardKeys.fleets()).toEqual(['dashboard', 'fleet'])
    expect(dashboardKeys.fleet()).toEqual(['dashboard', 'fleet', '30d'])
    expect(dashboardKeys.fleet('90d').slice(0, -1)).toEqual(dashboardKeys.fleets())
  })
})

describe('goal query keys', () => {
  it('isolates goal details by property as well as goal', () => {
    expect(goalKeys.detail('property-1', 'goal-1')).toEqual([
      'goals',
      'detail',
      'property-1',
      'goal-1',
    ])
  })

  it('keeps goal subject data in one property-scoped portal subtree', () => {
    expect(portalKeys.goalSubjects('property-1')).toEqual([
      'portals',
      'goal-subjects',
      'property-1',
    ])
    expect(portalKeys.goalSubjectNames('property-1')).toEqual([
      'portals',
      'goal-subjects',
      'property-1',
      'names',
    ])
  })
})

describe('portal analytics query keys', () => {
  it('isolates each range within a property-scoped portal analytics subtree', () => {
    expect(portalKeys.analytics('property-1', 'portal-1', 'last_30_days')).toEqual([
      'portals',
      'property',
      'property-1',
      'portal',
      'portal-1',
      'analytics',
      'last_30_days',
    ])
  })
})
