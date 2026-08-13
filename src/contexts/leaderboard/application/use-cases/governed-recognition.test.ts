import { describe, expect, it, vi } from 'vitest'
import type { RecognitionRepository } from '../ports/recognition.repository'
import { createRecognitionUseCases } from './governed-recognition'

function repository(): RecognitionRepository {
  return {
    getSettings: vi.fn(),
    activate: vi.fn(),
    deactivate: vi.fn(),
    resolveVisiblePortalGroupIds: vi.fn().mockResolvedValue(['allowed-group']),
    getBoard: vi.fn().mockResolvedValue(null),
    reconcileProperty: vi.fn(),
    listActivePropertyScopes: vi.fn().mockResolvedValue([]),
  }
}

describe('recognition access use cases', () => {
  it('does not let Staff widen the server-derived group scope', async () => {
    const repo = repository()
    const useCases = createRecognitionUseCases(repo)
    await expect(
      useCases.getBoard(
        { organizationId: 'org-1', userId: 'staff-1', role: 'Staff' },
        { propertyId: 'property-1', portalGroupId: 'other-group' },
      ),
    ).rejects.toThrow('recognition_group_forbidden')
    expect(repo.getBoard).not.toHaveBeenCalled()
  })

  it('passes only server-derived groups to the board repository', async () => {
    const repo = repository()
    const useCases = createRecognitionUseCases(repo)
    await useCases.getBoard(
      { organizationId: 'org-1', userId: 'staff-1', role: 'Staff' },
      { propertyId: 'property-1' },
    )
    expect(repo.getBoard).toHaveBeenCalledWith({
      organizationId: 'org-1',
      propertyId: 'property-1',
      portalGroupId: undefined,
      visiblePortalGroupIds: ['allowed-group'],
    })
  })

  it('rejects Staff activation before repository work', async () => {
    const repo = repository()
    const useCases = createRecognitionUseCases(repo)
    await expect(
      useCases.activate(
        { organizationId: 'org-1', userId: 'staff-1', role: 'Staff' },
        {
          propertyId: 'property-1',
          policyVersion: 'beta-local-1',
          jurisdiction: 'US-CA',
          noticeStatus: 'completed',
          consultationStatus: 'not_required',
          audience: 'property_managers_and_scoped_staff',
          selectedPortalGroupIds: ['group-1'],
          metricDefinitionVersionId: 'version-1',
          aggregation: 'ratio',
          periodKind: 'monthly',
          minimumExposure: 5,
          minimumSample: 5,
          freshnessSeconds: 3_600,
          minimumCompleteness: 0.9,
        },
        new Date(),
      ),
    ).rejects.toThrow('recognition_manager_required')
    expect(repo.activate).not.toHaveBeenCalled()
  })
})
