import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import {
  notificationPropertyDeliveryWindows,
  notificationUserSettings,
  properties,
} from '#/shared/db/schema'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import type { NotificationUserSettings } from '../domain/notification-types'
import { getUserSettings, upsertUserSettings } from './notification-preferences.server'
import { createNotificationUserSettings } from './user-settings.server'

const ORG = organizationId('user-settings-org-sofia')
const USER = userId('user-settings-user-1')
const PROPERTY = propertyId('85000000-0000-4000-8000-000000000001')
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

describe.sequential('notification user settings (real PostgreSQL)', () => {
  let lease: TestLease
  let db: Database

  const resolveOrganizationScope = vi.fn()
  const build = async (
    row: NotificationUserSettings | null,
    organizationTimezone: string | null,
  ) => {
    if (row) await upsertUserSettings(db, row)
    resolveOrganizationScope.mockResolvedValue({
      timezone: organizationTimezone,
      propertyNames: new Map<string, string>(),
    })
    return createNotificationUserSettings({
      db,
      resolveOrganizationScope,
      clock: () => NOW,
    })
  }
  const storedSettings = () => getUserSettings(db, USER, ORG)
  const storedWindows = () =>
    db
      .select()
      .from(notificationPropertyDeliveryWindows)
      .where(
        and(
          eq(notificationPropertyDeliveryWindows.userId, USER),
          eq(notificationPropertyDeliveryWindows.organizationId, ORG),
        ),
      )

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool) as Database
    await db.delete(properties).where(eq(properties.id, PROPERTY))
    await db.insert(properties).values({
      id: PROPERTY,
      organizationId: ORG,
      name: 'User Settings Test Property',
      slug: 'user-settings-test',
      timezone: 'UTC',
    })
  })

  const clear = async () => {
    await db
      .delete(notificationPropertyDeliveryWindows)
      .where(eq(notificationPropertyDeliveryWindows.userId, USER))
    await db
      .delete(notificationUserSettings)
      .where(eq(notificationUserSettings.userId, USER))
  }

  beforeEach(async () => {
    resolveOrganizationScope.mockReset()
    await clear()
  })

  afterAll(async () => {
    await clear()
    await db?.delete(properties).where(eq(properties.id, PROPERTY))
    await lease?.release()
  })

  describe('effective notification settings (ADR 0046 r.3)', () => {
    it("reads the Organization's timezone for a user who never saved one, not UTC", async () => {
      const settings = await build(null, 'Europe/Sofia')

      await expect(settings.read(USER, ORG)).resolves.toEqual({
        locale: 'en',
        timezone: 'Europe/Sofia',
        timezoneSource: 'organization',
        ...OPEN_WINDOW,
      })
    })

    it("reads the user's own timezone without consulting the Organization", async () => {
      const settings = await build(saved(), 'Europe/Sofia')

      await expect(settings.read(USER, ORG)).resolves.toEqual({
        locale: 'en-GB',
        timezone: 'America/Denver',
        timezoneSource: 'user',
        ...OPEN_WINDOW,
      })
      expect(resolveOrganizationScope).not.toHaveBeenCalled()
    })

    it('says UTC is only a default when neither the user nor the Organization has a zone', async () => {
      const settings = await build(null, null)

      await expect(settings.read(USER, ORG)).resolves.toEqual({
        locale: 'en',
        timezone: 'UTC',
        timezoneSource: 'default',
        ...OPEN_WINDOW,
      })
    })

    it('keeps the timezone delivery already uses when a first save changes only the language', async () => {
      const settings = await build(null, 'Europe/Sofia')

      await settings.save(USER, ORG, { locale: 'en-GB' })

      await expect(storedSettings()).resolves.toMatchObject({
        locale: 'en-GB',
        timezone: 'Europe/Sofia',
      })
    })

    it('keeps a saved timezone when a save changes only the language', async () => {
      const settings = await build(saved(), 'Europe/Sofia')

      await settings.save(USER, ORG, { locale: 'en' })

      await expect(storedSettings()).resolves.toMatchObject({
        locale: 'en',
        timezone: 'America/Denver',
      })
    })

    it('keeps the saved language when a save changes only the timezone', async () => {
      const settings = await build(saved(), 'Europe/Sofia')

      const result = await settings.save(USER, ORG, { timezone: 'Asia/Tokyo' })

      await expect(storedSettings()).resolves.toMatchObject({
        locale: 'en-GB',
        timezone: 'Asia/Tokyo',
        updatedAt: NOW,
      })
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
      const settings = await build(
        saved({ quietHoursStart: '22:00', quietHoursEnd: '07:00' }),
        'Europe/Sofia',
      )

      await settings.save(USER, ORG, { timezone: 'Asia/Tokyo' })

      await expect(storedSettings()).resolves.toMatchObject({
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
      })
    })
  })

  describe('personal quiet hours (ADR 0046, amended 2026-09-23)', () => {
    it('saves one window for every property the person has', async () => {
      const settings = await build(saved(), 'Europe/Sofia')

      const result = await settings.saveQuietHours(USER, ORG, {
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
        urgentBypassEnabled: true,
      })

      await expect(storedSettings()).resolves.toMatchObject({
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
        urgentBypassEnabled: true,
        timezone: 'America/Denver',
        locale: 'en-GB',
      })
      expect(result.quietHoursStart).toBe('22:00')
      await expect(storedWindows()).resolves.toEqual([])
    })

    it('refuses a window that starts and ends at the same time', async () => {
      const settings = await build(saved(), 'Europe/Sofia')

      await expect(
        settings.saveQuietHours(USER, ORG, {
          quietHoursStart: '22:00',
          quietHoursEnd: '22:00',
        }),
      ).rejects.toMatchObject({
        message: 'Quiet hours must start and end at different times',
      })
      await expect(storedSettings()).resolves.toMatchObject({
        quietHoursStart: null,
        quietHoursEnd: null,
      })
    })

    it('writes one property override without touching the personal window', async () => {
      const settings = await build(
        saved({ quietHoursStart: '22:00', quietHoursEnd: '07:00' }),
        'Europe/Sofia',
      )

      await settings.saveQuietHours(USER, ORG, {
        propertyId: PROPERTY,
        quietHoursStart: '00:00',
        quietHoursEnd: '06:00',
        urgentBypassEnabled: false,
      })

      await expect(storedWindows()).resolves.toEqual([
        expect.objectContaining({
          propertyId: PROPERTY,
          quietHoursStart: '00:00:00',
          quietHoursEnd: '06:00:00',
        }),
      ])
      await expect(storedSettings()).resolves.toMatchObject({
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      })
    })

    it('stores a property override that holds nothing back at all', async () => {
      const settings = await build(
        saved({ quietHoursStart: '22:00', quietHoursEnd: '07:00' }),
        'Europe/Sofia',
      )

      await settings.saveQuietHours(USER, ORG, {
        propertyId: PROPERTY,
        quietHoursStart: null,
        quietHoursEnd: null,
        urgentBypassEnabled: false,
      })

      await expect(storedWindows()).resolves.toEqual([
        expect.objectContaining({ quietHoursStart: null, quietHoursEnd: null }),
      ])
    })

    it('removes the override when a property follows the person again', async () => {
      const settings = await build(saved(), 'Europe/Sofia')
      await settings.saveQuietHours(USER, ORG, {
        propertyId: PROPERTY,
        quietHoursStart: '00:00',
        quietHoursEnd: '06:00',
      })

      await settings.saveQuietHours(USER, ORG, { propertyId: PROPERTY, follow: true })

      await expect(storedWindows()).resolves.toEqual([])
    })
  })
})
