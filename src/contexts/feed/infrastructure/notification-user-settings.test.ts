import { describe, expect, it, vi } from 'vitest'
import { organizationId, userId } from '#/shared/domain/ids'
import type { NotificationUserSettings } from '../domain/notification-types'
import { createNotificationUserSettings } from './notification-user-settings'

const ORG = organizationId('org-sofia')
const USER = userId('user-1')
const NOW = new Date('2026-09-21T20:30:00.000Z')

const saved = (
  overrides: Partial<NotificationUserSettings> = {},
): NotificationUserSettings => ({
  userId: USER,
  organizationId: ORG,
  locale: 'en-GB',
  timezone: 'America/Denver',
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  ...overrides,
})

function build(
  row: NotificationUserSettings | null,
  organizationTimezone: string | null,
) {
  const deps = {
    preferenceRepo: {
      getUserSettings: vi.fn(async () => row),
      upsertUserSettings: vi.fn(async (settings: NotificationUserSettings) => settings),
    },
    resolveOrganizationScope: vi.fn(async () => ({
      timezone: organizationTimezone,
      propertyNames: new Map<string, string>(),
    })),
    clock: () => NOW,
  }
  return { deps, settings: createNotificationUserSettings(deps) }
}

describe('effective notification settings (ADR 0046 r.3)', () => {
  it("reads the Organization's timezone for a user who never saved one, not UTC", async () => {
    const { settings } = build(null, 'Europe/Sofia')

    await expect(settings.read(USER, ORG)).resolves.toEqual({
      locale: 'en',
      timezone: 'Europe/Sofia',
      timezoneSource: 'organization',
    })
  })

  it("reads the user's own timezone without consulting the Organization", async () => {
    const { deps, settings } = build(saved(), 'Europe/Sofia')

    await expect(settings.read(USER, ORG)).resolves.toEqual({
      locale: 'en-GB',
      timezone: 'America/Denver',
      timezoneSource: 'user',
    })
    expect(deps.resolveOrganizationScope).not.toHaveBeenCalled()
  })

  it('says UTC is only a default when neither the user nor the Organization has a zone', async () => {
    const { settings } = build(null, null)

    await expect(settings.read(USER, ORG)).resolves.toEqual({
      locale: 'en',
      timezone: 'UTC',
      timezoneSource: 'default',
    })
  })

  it('keeps the timezone delivery already uses when a first save changes only the language', async () => {
    const { deps, settings } = build(null, 'Europe/Sofia')

    await settings.save(USER, ORG, { locale: 'en-GB' })

    expect(deps.preferenceRepo.upsertUserSettings).toHaveBeenCalledWith(
      expect.objectContaining({ locale: 'en-GB', timezone: 'Europe/Sofia' }),
    )
  })

  it('keeps a saved timezone when a save changes only the language', async () => {
    const { deps, settings } = build(saved(), 'Europe/Sofia')

    await settings.save(USER, ORG, { locale: 'bg' })

    expect(deps.preferenceRepo.upsertUserSettings).toHaveBeenCalledWith(
      expect.objectContaining({ locale: 'bg', timezone: 'America/Denver' }),
    )
  })

  it('keeps the saved language when a save changes only the timezone', async () => {
    const { deps, settings } = build(saved(), 'Europe/Sofia')

    const result = await settings.save(USER, ORG, { timezone: 'Asia/Tokyo' })

    expect(deps.preferenceRepo.upsertUserSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: 'en-GB',
        timezone: 'Asia/Tokyo',
        updatedAt: NOW,
      }),
    )
    expect(result).toEqual({
      locale: 'en-GB',
      timezone: 'Asia/Tokyo',
      timezoneSource: 'user',
    })
  })
})
