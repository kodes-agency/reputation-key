import { describe, expect, it, vi } from 'vitest'
import {
  notificationPreferenceId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { muteNotificationCategory } from './mute-notification-category'

const NOW = new Date('2026-08-26T08:00:00.000Z')

describe('mute notification category', () => {
  it('constructs the governed default only for first insert', async () => {
    const upsertEnabled = vi.fn(async (preference) => preference)

    const result = await muteNotificationCategory(
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
        upsertEnabled,
      },
    )

    expect(result).toMatchObject({
      enabled: false,
      cadence: 'daily',
      urgentBypassEnabled: false,
      quietHoursStart: null,
      quietHoursEnd: null,
    })
    expect(upsertEnabled).toHaveBeenCalledWith(result)
  })

  it('rejects muting mandatory notifications before persistence', async () => {
    const upsertEnabled = vi.fn()

    await expect(
      muteNotificationCategory(
        {
          userId: userId('10000000-0000-4000-8000-000000000001'),
          organizationId: organizationId('10000000-0000-4000-8000-000000000002'),
          propertyId: propertyId('10000000-0000-4000-8000-000000000003'),
          category: 'mandatory',
          channel: 'in_app',
        },
        {
          newId: () => notificationPreferenceId('10000000-0000-4000-8000-000000000004'),
          clock: () => NOW,
          upsertEnabled,
        },
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(upsertEnabled).not.toHaveBeenCalled()
  })
})
