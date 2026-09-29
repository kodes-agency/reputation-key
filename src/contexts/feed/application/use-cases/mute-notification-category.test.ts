import { describe, expect, it, vi } from 'vitest'
import {
  notificationPreferenceId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import {
  muteNotificationCategory,
  undoNotificationCategoryMute,
} from './mute-notification-category'

const NOW = new Date('2026-08-26T08:00:00.000Z')

const INPUT = {
  userId: userId('10000000-0000-4000-8000-000000000001'),
  organizationId: organizationId('10000000-0000-4000-8000-000000000002'),
  propertyId: propertyId('10000000-0000-4000-8000-000000000003'),
  category: 'workflow_collaboration',
  channel: 'in_app',
} as const

const DEPS = {
  newId: () => notificationPreferenceId('10000000-0000-4000-8000-000000000004'),
  clock: () => NOW,
  findPropertyPreference: async () => null,
}

describe('mute notification category', () => {
  it('constructs the governed default only for first insert', async () => {
    const upsertEnabled = vi.fn(async (preference) => preference)
    const findPropertyPreference = vi.fn(async () => null)

    const { preference: result, previous } = await muteNotificationCategory(
      {
        userId: userId('10000000-0000-4000-8000-000000000001'),
        organizationId: organizationId('10000000-0000-4000-8000-000000000002'),
        propertyId: propertyId('10000000-0000-4000-8000-000000000003'),
        category: 'workflow_collaboration',
        channel: 'in_app',
      },
      {
        newId: () => notificationPreferenceId('10000000-0000-4000-8000-000000000004'),
        clock: () => NOW,
        findPropertyPreference,
        upsertEnabled,
      },
    )

    expect(result).toMatchObject({ enabled: false, cadence: 'daily' })
    expect(upsertEnabled).toHaveBeenCalledWith(result)
    expect(previous).toBeNull()
  })

  it('reports the row the Property had of its own, so an undo can put it back', async () => {
    const { previous } = await muteNotificationCategory(INPUT, {
      ...DEPS,
      findPropertyPreference: async () => ({ enabled: true, cadence: 'immediate' }),
      upsertEnabled: async (preference) => preference,
    })

    expect(previous).toEqual({ enabled: true })
  })

  it('undoes a mute on a Property that inherited by removing the row it made', async () => {
    const deletePropertyPreference = vi.fn(async () => undefined)
    const upsertEnabled = vi.fn()

    await undoNotificationCategoryMute(
      { ...INPUT, previous: null },
      { ...DEPS, upsertEnabled, deletePropertyPreference },
    )

    expect(deletePropertyPreference).toHaveBeenCalledWith(
      INPUT.userId,
      INPUT.organizationId,
      INPUT.propertyId,
      'workflow_collaboration',
      'in_app',
    )
    expect(upsertEnabled).not.toHaveBeenCalled()
  })

  it("undoes a mute on a Property with its own row by restoring that row's switch", async () => {
    const upsertEnabled = vi.fn(async (preference) => preference)
    const deletePropertyPreference = vi.fn()

    await undoNotificationCategoryMute(
      { ...INPUT, previous: { enabled: true } },
      { ...DEPS, upsertEnabled, deletePropertyPreference },
    )

    expect(upsertEnabled).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }))
    expect(deletePropertyPreference).not.toHaveBeenCalled()
  })

  it.each(['mandatory', 'urgent_operational'] as const)(
    'refuses to undo a mute of required %s notifications, which cannot be muted',
    async (category) => {
      const deletePropertyPreference = vi.fn()

      await expect(
        undoNotificationCategoryMute(
          { ...INPUT, category, previous: null },
          { ...DEPS, upsertEnabled: vi.fn(), deletePropertyPreference },
        ),
      ).rejects.toMatchObject({ code: 'invalid_input' })
      expect(deletePropertyPreference).not.toHaveBeenCalled()
    },
  )

  it.each(['mandatory', 'urgent_operational'] as const)(
    'rejects muting required %s in-app notifications before persistence',
    async (category) => {
      const upsertEnabled = vi.fn()

      await expect(
        muteNotificationCategory(
          {
            userId: userId('10000000-0000-4000-8000-000000000001'),
            organizationId: organizationId('10000000-0000-4000-8000-000000000002'),
            propertyId: propertyId('10000000-0000-4000-8000-000000000003'),
            category,
            channel: 'in_app',
          },
          {
            newId: () => notificationPreferenceId('10000000-0000-4000-8000-000000000004'),
            clock: () => NOW,
            findPropertyPreference: vi.fn(async () => null),
            upsertEnabled,
          },
        ),
      ).rejects.toMatchObject({ code: 'invalid_input' })
      expect(upsertEnabled).not.toHaveBeenCalled()
    },
  )
})
