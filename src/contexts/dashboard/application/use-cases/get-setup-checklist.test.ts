import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type {
  SetupChecklistFacts,
  SetupChecklistRepository,
} from '../ports/setup-checklist.repository'
import { getSetupChecklist } from './get-setup-checklist'

const ORG = organizationId('org-setup-checklist')
const PROPERTY = propertyId('10000000-0000-4000-8000-000000000001')
const COMPLETED = new Date('2026-08-20T10:00:00.000Z')

function facts(overrides: Partial<SetupChecklistFacts> = {}): SetupChecklistFacts {
  return {
    anchorPropertyId: PROPERTY,
    googleConnection: {
      currentlySatisfied: true,
      firstCompletedAt: COMPLETED,
    },
    importedProperty: {
      currentlySatisfied: true,
      firstCompletedAt: COMPLETED,
    },
    initialReviewSync: {
      currentlySatisfied: true,
      firstCompletedAt: COMPLETED,
    },
    publishedPortal: {
      currentlySatisfied: true,
      firstCompletedAt: COMPLETED,
    },
    responsibleManagers: {
      currentlySatisfied: true,
      firstCompletedAt: COMPLETED,
    },
    ...overrides,
  }
}

function repository(value: SetupChecklistFacts): SetupChecklistRepository {
  return { readAndRecord: vi.fn(async () => value) }
}

describe('getSetupChecklist', () => {
  it('returns the five canonical AccountAdmin steps as historically and currently complete', async () => {
    const repo = repository(facts())
    const getChecklist = getSetupChecklist({ repository: repo })

    const result = await getChecklist({
      organizationId: ORG,
      role: 'AccountAdmin',
      accessiblePropertyIds: null,
      allowedActions: {
        manageGoogle: true,
        importProperty: true,
        createPortal: true,
        assignManagers: true,
      },
    })

    expect(result).toMatchObject({
      role: 'AccountAdmin',
      accessState: 'organization',
      state: 'complete',
    })
    expect(result.steps.map((step) => step.key)).toEqual([
      'google_connection',
      'imported_property',
      'initial_review_sync',
      'published_portal',
      'responsible_managers',
    ])
    expect(result.steps.every((step) => step.status === 'complete')).toBe(true)
    expect(repo.readAndRecord).toHaveBeenCalledWith({
      organizationId: ORG,
      accessiblePropertyIds: null,
    })
  })

  it('keeps historical completion while exposing a later outage and its authorized recovery action', async () => {
    const getChecklist = getSetupChecklist({
      repository: repository(
        facts({
          googleConnection: {
            currentlySatisfied: false,
            firstCompletedAt: COMPLETED,
          },
        }),
      ),
    })

    const result = await getChecklist({
      organizationId: ORG,
      role: 'AccountAdmin',
      accessiblePropertyIds: null,
      allowedActions: {
        manageGoogle: true,
        importProperty: true,
        createPortal: true,
        assignManagers: true,
      },
    })

    expect(result.state).toBe('degraded')
    expect(result.steps[0]).toMatchObject({
      status: 'degraded',
      firstCompletedAt: COMPLETED,
      action: { kind: 'manage_google' },
    })
  })

  it('shows an assigned PropertyManager only actions allowed within current scope', async () => {
    const getChecklist = getSetupChecklist({
      repository: repository(
        facts({
          googleConnection: { currentlySatisfied: false, firstCompletedAt: null },
          importedProperty: { currentlySatisfied: false, firstCompletedAt: null },
          initialReviewSync: { currentlySatisfied: false, firstCompletedAt: null },
          publishedPortal: { currentlySatisfied: false, firstCompletedAt: null },
          responsibleManagers: { currentlySatisfied: false, firstCompletedAt: null },
        }),
      ),
    })

    const result = await getChecklist({
      organizationId: ORG,
      role: 'PropertyManager',
      accessiblePropertyIds: [PROPERTY],
      allowedActions: {
        manageGoogle: false,
        importProperty: false,
        createPortal: true,
        assignManagers: true,
      },
    })

    expect(result.accessState).toBe('assigned')
    expect(
      result.steps.map(({ status, action }) => [status, action?.kind ?? null]),
    ).toEqual([
      ['waiting', null],
      ['waiting', null],
      ['waiting', null],
      ['incomplete', 'manage_portals'],
      ['incomplete', 'assign_managers'],
    ])
  })

  it('does not query tenant facts or expose actions to a manager with no Property access', async () => {
    const repo = repository(facts())
    const getChecklist = getSetupChecklist({ repository: repo })

    const result = await getChecklist({
      organizationId: ORG,
      role: 'PropertyManager',
      accessiblePropertyIds: [],
      allowedActions: {
        manageGoogle: false,
        importProperty: false,
        createPortal: true,
        assignManagers: true,
      },
    })

    expect(result.state).toBe('no_access')
    expect(result.accessState).toBe('no_access')
    expect(result.steps.every((step) => step.status === 'no_access')).toBe(true)
    expect(result.steps.every((step) => step.action === null)).toBe(true)
    expect(repo.readAndRecord).not.toHaveBeenCalled()
  })

  it('rejects Staff so the beta-dark role cannot acquire an authenticated setup surface', async () => {
    const getChecklist = getSetupChecklist({ repository: repository(facts()) })

    await expect(
      getChecklist({
        organizationId: ORG,
        role: 'Staff',
        accessiblePropertyIds: [],
        allowedActions: {
          manageGoogle: false,
          importProperty: false,
          createPortal: false,
          assignManagers: false,
        },
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })
})
