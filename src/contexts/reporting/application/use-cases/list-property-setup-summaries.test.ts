import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type {
  PropertySetupFacts,
  PropertySetupRepository,
} from '../ports/property-setup.repository'
import { listPropertySetupSummaries } from './list-property-setup-summaries'

const ORG = organizationId('org-property-setup-summaries')
const CONFIGURED = propertyId('10000000-0000-4000-8000-00000000c001')
const DEFERRED = propertyId('10000000-0000-4000-8000-00000000c002')

const FACTS: readonly PropertySetupFacts[] = [
  {
    propertyId: CONFIGURED,
    googleBindingActive: true,
    reviewsSyncedForCurrentSource: true,
    replyLanguageChosen: true,
    merchantAiState: 'enabled',
    aiDecisionDeferred: false,
    responsibleManagerAssigned: true,
    replyVoiceConfigured: true,
    portalPublished: true,
  },
  {
    propertyId: DEFERRED,
    googleBindingActive: false,
    reviewsSyncedForCurrentSource: false,
    replyLanguageChosen: true,
    merchantAiState: 'disabled',
    aiDecisionDeferred: true,
    responsibleManagerAssigned: false,
    replyVoiceConfigured: false,
    portalPublished: false,
  },
]

function repository(facts: readonly PropertySetupFacts[] = FACTS) {
  return {
    readPropertyFacts: vi.fn(async () => null),
    listPropertyFacts: vi.fn(async () => facts),
  } satisfies PropertySetupRepository
}

describe('listPropertySetupSummaries', () => {
  it('summarises every accessible Property with its attention count', async () => {
    const repo = repository()

    await expect(
      listPropertySetupSummaries({ repository: repo })({
        organizationId: ORG,
        role: 'AccountAdmin',
        accessiblePropertyIds: null,
      }),
    ).resolves.toEqual([
      { propertyId: CONFIGURED, attentionCount: 0 },
      // Google, first sync, manager, voice, portal; the deferral counts as decided.
      { propertyId: DEFERRED, attentionCount: 5 },
    ])
    expect(repo.listPropertyFacts).toHaveBeenCalledWith({
      organizationId: ORG,
      accessiblePropertyIds: null,
    })
  })

  it('passes a PropertyManager grant set through as the exact read scope', async () => {
    const repo = repository([FACTS[1]!])

    await expect(
      listPropertySetupSummaries({ repository: repo })({
        organizationId: ORG,
        role: 'PropertyManager',
        accessiblePropertyIds: [DEFERRED],
      }),
    ).resolves.toEqual([{ propertyId: DEFERRED, attentionCount: 5 }])
    expect(repo.listPropertyFacts).toHaveBeenCalledWith({
      organizationId: ORG,
      accessiblePropertyIds: [DEFERRED],
    })
  })

  it('returns nothing for a manager without grants and skips the tenant read', async () => {
    const repo = repository()

    await expect(
      listPropertySetupSummaries({ repository: repo })({
        organizationId: ORG,
        role: 'PropertyManager',
        accessiblePropertyIds: [],
      }),
    ).resolves.toEqual([])
    expect(repo.listPropertyFacts).not.toHaveBeenCalled()
  })

  it('rejects the beta-dark Member role', async () => {
    const repo = repository()

    await expect(
      listPropertySetupSummaries({ repository: repo })({
        organizationId: ORG,
        role: 'Member',
        accessiblePropertyIds: null,
      }),
    ).rejects.toMatchObject({ _tag: 'DashboardError', code: 'forbidden' })
    expect(repo.listPropertyFacts).not.toHaveBeenCalled()
  })
})
