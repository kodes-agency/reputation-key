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

  it('keeps the portals overview in the property subtree, apart from the plain list', () => {
    expect(portalKeys.overview('property-1')).toEqual([
      'portals',
      'property',
      'property-1',
      'overview',
    ])
    expect(portalKeys.overview('property-1')).not.toEqual(portalKeys.list('property-1'))
  })

  it('keeps the New portal options in the property subtree, so a Property edit refreshes them', () => {
    expect(portalKeys.creationOptions('property-1')).toEqual([
      'portals',
      'property',
      'property-1',
      'creation-options',
    ])
  })

  it('keeps each window of the overview results in its own read, under the property', () => {
    expect(portalKeys.resultsOverviewRoot('property-1')).toEqual([
      'portals',
      'property',
      'property-1',
      'results-overview',
    ])
    expect(portalKeys.resultsOverview('property-1', '30d', true)).toEqual([
      'portals',
      'property',
      'property-1',
      'results-overview',
      '30d',
      'compare',
    ])
    expect(portalKeys.resultsOverview('property-1', '30d', false)).not.toEqual(
      portalKeys.resultsOverview('property-1', '30d', true),
    )
    expect(portalKeys.resultsOverview('property-1', '7d', true)).not.toEqual(
      portalKeys.resultsOverview('property-1', '30d', true),
    )
  })

  it('keeps the Organization-wide overview and its results in their own subtree, apart from every Property', () => {
    expect(portalKeys.organizationOverview()).toEqual([
      'portals',
      'organization',
      'overview',
    ])
    expect(portalKeys.organizationResultsOverviewRoot()).toEqual([
      'portals',
      'organization',
      'results-overview',
    ])
    expect(portalKeys.organizationResultsOverview('30d', true)).toEqual([
      'portals',
      'organization',
      'results-overview',
      '30d',
      'compare',
    ])
    expect(portalKeys.organizationResultsOverview('30d', false)).not.toEqual(
      portalKeys.organizationResultsOverview('30d', true),
    )
    expect(portalKeys.organizationResultsOverview('7d', true)).not.toEqual(
      portalKeys.organizationResultsOverview('30d', true),
    )
    expect(portalKeys.organizationOverview().slice(0, 2)).not.toEqual(
      portalKeys.overview('property-1').slice(0, 2),
    )
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

describe('portal language coverage query key', () => {
  it('descends from the Portal experience, so a Property-wide or Portal content write refreshes it', () => {
    const key = portalKeys.languageCoverage('property-1', 'portal-1')
    expect(key.slice(0, -1)).toEqual(portalKeys.experience('property-1', 'portal-1'))
    expect(key.slice(0, portalKeys.propertyExperience('property-1').length)).toEqual(
      portalKeys.propertyExperience('property-1'),
    )
  })

  it('is isolated per Portal', () => {
    expect(portalKeys.languageCoverage('property-1', 'portal-1')).not.toEqual(
      portalKeys.languageCoverage('property-1', 'portal-2'),
    )
  })
})

describe('portal preview query key', () => {
  it('descends from the publication history, which every working-copy write already refreshes', () => {
    const key = portalKeys.preview('portal-1', 'draft')
    expect(key.slice(0, portalKeys.publicationHistory('portal-1').length)).toEqual(
      portalKeys.publicationHistory('portal-1'),
    )
  })

  it('is isolated per Portal and per source', () => {
    expect(portalKeys.preview('portal-1', 'draft')).not.toEqual(
      portalKeys.preview('portal-1', 'live'),
    )
    expect(portalKeys.preview('portal-1', 'draft')).not.toEqual(
      portalKeys.preview('portal-2', 'draft'),
    )
  })
})

describe('portal preview copy query key', () => {
  it('is per language and outside every Portal, so no Portal write refreshes it', () => {
    expect(portalKeys.previewCopy('bg')).toEqual(['portals', 'preview-copy', 'bg'])
    expect(portalKeys.previewCopy('bg')).not.toEqual(portalKeys.previewCopy('en'))
  })
})

describe('portal analytics query keys', () => {
  it('isolates each range within a property-scoped portal analytics subtree', () => {
    expect(portalKeys.analytics('property-1', 'portal-1', 'last_30_days', true)).toEqual([
      'portals',
      'property',
      'property-1',
      'portal',
      'portal-1',
      'analytics',
      'last_30_days',
      'compare',
    ])
  })

  it('keeps a window read with its comparison apart from one without', () => {
    expect(portalKeys.analytics('property-1', 'portal-1', '30d', true)).not.toEqual(
      portalKeys.analytics('property-1', 'portal-1', '30d', false),
    )
  })
})
