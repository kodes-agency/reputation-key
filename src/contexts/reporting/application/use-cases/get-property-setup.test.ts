import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type {
  PropertySetupFacts,
  PropertySetupRepository,
} from '../ports/property-setup.repository'
import { getPropertySetup } from './get-property-setup'

const ORG = organizationId('org-property-setup')
const PROPERTY = propertyId('10000000-0000-4000-8000-00000000b001')
const OTHER_PROPERTY = propertyId('10000000-0000-4000-8000-00000000b002')

const UNCONFIGURED: PropertySetupFacts = {
  propertyId: PROPERTY,
  googleBindingActive: true,
  reviewsSyncedForCurrentSource: false,
  replyLanguageChosen: false,
  merchantAiState: 'disabled',
  aiDecisionDeferred: false,
  responsibleManagerAssigned: true,
  replyVoiceConfigured: false,
  portalPublished: false,
}

function repository(facts: PropertySetupFacts | null = UNCONFIGURED) {
  return {
    readPropertyFacts: vi.fn(async () => facts),
    listPropertyFacts: vi.fn(async () => []),
  } satisfies PropertySetupRepository
}

describe('getPropertySetup', () => {
  it('derives the steps and attention count for an Organization-wide AccountAdmin', async () => {
    const repo = repository()

    const setup = await getPropertySetup({ repository: repo })({
      organizationId: ORG,
      role: 'AccountAdmin',
      propertyId: PROPERTY,
      accessiblePropertyIds: null,
    })

    expect(repo.readPropertyFacts).toHaveBeenCalledWith({
      organizationId: ORG,
      propertyId: PROPERTY,
    })
    expect(setup.propertyId).toBe(PROPERTY)
    expect(setup.steps.map(({ key, status }) => [key, status])).toEqual([
      ['google_linked', 'complete'],
      ['reviews_synced', 'waiting'],
      ['reply_language', 'pending'],
      ['ai_decision', 'pending'],
      ['responsible_manager', 'complete'],
      ['reply_voice', 'pending'],
      ['portal_published', 'pending'],
    ])
    expect(setup.attentionCount).toBe(4)
  })

  it('lets the viewer role decide needs_admin for a granted PropertyManager', async () => {
    const setup = await getPropertySetup({ repository: repository() })({
      organizationId: ORG,
      role: 'PropertyManager',
      propertyId: PROPERTY,
      accessiblePropertyIds: [OTHER_PROPERTY, PROPERTY],
    })

    expect(setup.steps.find((step) => step.key === 'ai_decision')?.status).toBe(
      'needs_admin',
    )
    expect(setup.attentionCount).toBe(4)
  })

  it('refuses an ungranted Property without reading tenant facts', async () => {
    const repo = repository()

    await expect(
      getPropertySetup({ repository: repo })({
        organizationId: ORG,
        role: 'PropertyManager',
        propertyId: PROPERTY,
        accessiblePropertyIds: [OTHER_PROPERTY],
      }),
    ).rejects.toMatchObject({ _tag: 'DashboardError', code: 'forbidden' })
    expect(repo.readPropertyFacts).not.toHaveBeenCalled()
  })

  it('reports a Property that is absent or deleted as not found', async () => {
    await expect(
      getPropertySetup({ repository: repository(null) })({
        organizationId: ORG,
        role: 'AccountAdmin',
        propertyId: PROPERTY,
        accessiblePropertyIds: null,
      }),
    ).rejects.toMatchObject({ _tag: 'DashboardError', code: 'not_found' })
  })

  it('rejects the beta-dark Member role before any read', async () => {
    const repo = repository()

    await expect(
      getPropertySetup({ repository: repo })({
        organizationId: ORG,
        role: 'Member',
        propertyId: PROPERTY,
        accessiblePropertyIds: [PROPERTY],
      }),
    ).rejects.toMatchObject({ _tag: 'DashboardError', code: 'forbidden' })
    expect(repo.readPropertyFacts).not.toHaveBeenCalled()
  })
})
