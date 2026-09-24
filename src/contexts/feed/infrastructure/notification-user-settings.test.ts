import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import type { NotificationUserSettings } from '../domain/notification-types'
import { createNotificationUserSettings } from './notification-user-settings'

const ORG = organizationId('org-sofia')
const USER = userId('user-1')
const PROPERTY = propertyId('11111111-1111-4111-8111-111111111111')
const NOW = new Date('2026-09-21T20:30:00.000Z')

/** No quiet hours and no bypass: what a person who never chose either has. */
const OPEN_WINDOW = {
  quietHoursStart: null,
  quietHoursEnd: null,
  urgentBypassEnabled: false,
} as const

const saved = (
  overrides: Partial<NotificationUserSettings> = {},
): NotificationUserSettings => ({
  userId: USER,
  organizationId: ORG,
  locale: 'en-GB',
  timezone: 'America/Denver',
  ...OPEN_WINDOW,
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
      upsertPropertyDeliveryWindow: vi.fn(async (window) => window),
      clearPropertyDeliveryWindow: vi.fn(async () => {}),
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
      ...OPEN_WINDOW,
    })
  })

  it("reads the user's own timezone without consulting the Organization", async () => {
    const { deps, settings } = build(saved(), 'Europe/Sofia')

    await expect(settings.read(USER, ORG)).resolves.toEqual({
      locale: 'en-GB',
      timezone: 'America/Denver',
      timezoneSource: 'user',
      ...OPEN_WINDOW,
    })
    expect(deps.resolveOrganizationScope).not.toHaveBeenCalled()
  })

  it('says UTC is only a default when neither the user nor the Organization has a zone', async () => {
    const { settings } = build(null, null)

    await expect(settings.read(USER, ORG)).resolves.toEqual({
      locale: 'en',
      timezone: 'UTC',
      timezoneSource: 'default',
      ...OPEN_WINDOW,
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

    await settings.save(USER, ORG, { locale: 'en' })

    expect(deps.preferenceRepo.upsertUserSettings).toHaveBeenCalledWith(
      expect.objectContaining({ locale: 'en', timezone: 'America/Denver' }),
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
      ...OPEN_WINDOW,
    })
  })

  // The window and the timezone share one row, so each save must write the
  // other half back as it stands.
  it('keeps the quiet hours a formatting save never mentioned', async () => {
    const { deps, settings } = build(
      saved({ quietHoursStart: '22:00', quietHoursEnd: '07:00' }),
      'Europe/Sofia',
    )

    await settings.save(USER, ORG, { timezone: 'Asia/Tokyo' })

    expect(deps.preferenceRepo.upsertUserSettings).toHaveBeenCalledWith(
      expect.objectContaining({ quietHoursStart: '22:00', quietHoursEnd: '07:00' }),
    )
  })
})

describe('personal quiet hours (ADR 0046, amended 2026-09-23)', () => {
  it('saves one window for every property the person has', async () => {
    const { deps, settings } = build(saved(), 'Europe/Sofia')

    const result = await settings.saveQuietHours(USER, ORG, {
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
      urgentBypassEnabled: true,
    })

    expect(deps.preferenceRepo.upsertUserSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
        urgentBypassEnabled: true,
        timezone: 'America/Denver',
        locale: 'en-GB',
      }),
    )
    expect(result.quietHoursStart).toBe('22:00')
    expect(deps.preferenceRepo.upsertPropertyDeliveryWindow).not.toHaveBeenCalled()
  })

  it('refuses a window that starts and ends at the same time', async () => {
    const { deps, settings } = build(saved(), 'Europe/Sofia')

    await expect(
      settings.saveQuietHours(USER, ORG, {
        quietHoursStart: '22:00',
        quietHoursEnd: '22:00',
      }),
    ).rejects.toMatchObject({
      message: 'Quiet hours must start and end at different times',
    })
    expect(deps.preferenceRepo.upsertUserSettings).not.toHaveBeenCalled()
  })

  it('writes one property override without touching the personal window', async () => {
    const { deps, settings } = build(
      saved({ quietHoursStart: '22:00', quietHoursEnd: '07:00' }),
      'Europe/Sofia',
    )

    await settings.saveQuietHours(USER, ORG, {
      propertyId: PROPERTY,
      quietHoursStart: '00:00',
      quietHoursEnd: '06:00',
      urgentBypassEnabled: false,
    })

    expect(deps.preferenceRepo.upsertPropertyDeliveryWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyId: PROPERTY,
        quietHoursStart: '00:00',
        quietHoursEnd: '06:00',
      }),
    )
    expect(deps.preferenceRepo.upsertUserSettings).not.toHaveBeenCalled()
  })

  it('stores a property override that holds nothing back at all', async () => {
    const { deps, settings } = build(
      saved({ quietHoursStart: '22:00', quietHoursEnd: '07:00' }),
      'Europe/Sofia',
    )

    await settings.saveQuietHours(USER, ORG, {
      propertyId: PROPERTY,
      quietHoursStart: null,
      quietHoursEnd: null,
      urgentBypassEnabled: false,
    })

    expect(deps.preferenceRepo.upsertPropertyDeliveryWindow).toHaveBeenCalledWith(
      expect.objectContaining({ quietHoursStart: null, quietHoursEnd: null }),
    )
  })

  it('removes the override when a property follows the person again', async () => {
    const { deps, settings } = build(saved(), 'Europe/Sofia')

    await settings.saveQuietHours(USER, ORG, { propertyId: PROPERTY, follow: true })

    expect(deps.preferenceRepo.clearPropertyDeliveryWindow).toHaveBeenCalledWith(
      USER,
      ORG,
      PROPERTY,
    )
    expect(deps.preferenceRepo.upsertPropertyDeliveryWindow).not.toHaveBeenCalled()
  })
})
