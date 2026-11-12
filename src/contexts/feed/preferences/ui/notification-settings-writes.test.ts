import { createElement, type ComponentProps } from 'react'
import { renderToString } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import type { Action } from '#/components/hooks/use-action'
import {
  createNotificationCategoryDefault,
  createNotificationPreference,
} from '#/contexts/feed/domain/constructors-preference'
import {
  notificationPreferenceId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import type { NotificationsSettingsView } from './notifications-settings-view'
import { NotificationsSettingsPage } from './notifications-settings-page'

type View = ComponentProps<typeof NotificationsSettingsView>
const capture = vi.hoisted(() => ({ view: undefined as View | undefined }))
vi.mock('./notifications-settings-view', () => ({
  NotificationsSettingsView: (props: View) => {
    capture.view = props
    return null
  },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const PROPERTY = '10000000-0000-4000-8000-000000000001'
const OTHER = '10000000-0000-4000-8000-000000000002'
const CATEGORY = 'workflow_collaboration'
type Props = ComponentProps<typeof NotificationsSettingsPage>

function action<I, O>(fn: (input: I) => Promise<O>): Action<I, O> {
  return Object.assign(fn, {
    isPending: false,
    error: null,
    isSuccess: false,
    data: null,
  })
}

function row(input: Parameters<Props['updatePreference']>[0]) {
  return createNotificationPreference(
    {
      ...input.data,
      id: notificationPreferenceId('10000000-0000-4000-8000-000000000003'),
      propertyId: propertyId(input.data.propertyId),
      userId: userId('person'),
      organizationId: organizationId('organization'),
      maxRating: input.data.maxRating ?? null,
    },
    () => new Date('2026-09-23T10:00:00Z'),
  )._unsafeUnwrap()
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function settings(overrides: Partial<Props> = {}) {
  const update = vi.fn(async (input: Parameters<Props['updatePreference']>[0]) =>
    row(input),
  )
  const reset = vi.fn(async (_input: Parameters<Props['resetPropertyCategory']>[0]) => {})
  renderToString(
    createElement(NotificationsSettingsPage, {
      properties: [
        { id: PROPERTY, name: 'First' },
        { id: OTHER, name: 'Second' },
      ],
      propertyId: PROPERTY,
      preferences: [
        row({
          data: {
            propertyId: PROPERTY,
            category: CATEGORY,
            channel: 'email',
            enabled: true,
            cadence: 'immediate',
          },
        }),
      ],
      categoryDefaults: [],
      propertyWindows: [],
      userSettings: null,
      emailAvailability: 'allowed',
      retryEmailAvailability: () => {},
      setPropertyId: () => {},
      updatePreference: action(update),
      resetPropertyCategory: action(reset),
      updateQuietHours: action(async () => {
        throw new Error('Unexpected quiet-hours write')
      }),
      ...overrides,
    }),
  )
  if (!capture.view) throw new Error('Settings did not render')
  return { view: capture.view, update, reset }
}

beforeEach(() => {
  capture.view = undefined
  vi.clearAllMocks()
})

it('finishes an earlier save before resetting both channels to the default', async () => {
  const held = deferred()
  const events: string[] = []
  const { view } = settings({
    updatePreference: action(async (input) => {
      events.push('save started')
      await held.promise
      events.push('save finished')
      return row(input)
    }),
    resetPropertyCategory: action(async () => {
      events.push('reset')
    }),
  })
  const save = view.savePreference(CATEGORY, 'email', { enabled: false })
  const reset = view.resetToDefault(CATEGORY, [PROPERTY])
  await vi.waitFor(() => expect(events).toContain('save started'))
  expect(events).toEqual(['save started'])
  held.resolve()
  await Promise.all([save, reset])
  expect(events).toEqual(['save started', 'save finished', 'reset'])
})

it('builds a save queued after a reset from inherited values, not the removed row', async () => {
  const held = deferred()
  const { view, update } = settings({ resetPropertyCategory: action(() => held.promise) })
  const reset = view.resetToDefault(CATEGORY, [PROPERTY])
  const save = view.savePreference(CATEGORY, 'email', { enabled: true })
  await Promise.resolve()
  expect(update).not.toHaveBeenCalled()
  held.resolve()
  await Promise.all([reset, save])
  expect(update).toHaveBeenCalledExactlyOnceWith({
    data: {
      propertyId: PROPERTY,
      category: CATEGORY,
      channel: 'email',
      enabled: true,
      cadence: 'daily',
    },
  })
})

it('keeps both channels of Make this my default ahead of a subsequent reset', async () => {
  const held = deferred()
  const events: string[] = []
  const { view } = settings({
    updatePreference: action(async (input) => {
      events.push(input.data.channel)
      if (input.data.channel === 'in_app') await held.promise
      return row(input)
    }),
    resetPropertyCategory: action(async () => {
      events.push('reset')
    }),
  })
  const apply = view.applyToAll(CATEGORY)
  const reset = view.resetToDefault(CATEGORY, [OTHER])
  await vi.waitFor(() => expect(events).toContain('in_app'))
  expect(events).toEqual(['in_app'])
  held.resolve()
  await Promise.all([apply, reset])
  expect(events).toEqual(['in_app', 'email', 'reset'])
})

it('builds rapid edits on the completed save while the query props are still stale', async () => {
  const held = deferred()
  const inputs: Parameters<Props['updatePreference']>[0][] = []
  const { view } = settings({
    updatePreference: action(async (input) => {
      inputs.push(input)
      if (inputs.length === 1) await held.promise
      return row(input)
    }),
  })
  const disable = view.savePreference(CATEGORY, 'email', { enabled: false })
  const daily = view.savePreference(CATEGORY, 'email', { cadence: 'daily' })
  held.resolve()
  await Promise.all([disable, daily])
  expect(inputs.map((input) => input.data)).toEqual([
    {
      propertyId: PROPERTY,
      category: CATEGORY,
      channel: 'email',
      enabled: false,
      cadence: 'immediate',
    },
    {
      propertyId: PROPERTY,
      category: CATEGORY,
      channel: 'email',
      enabled: false,
      cadence: 'daily',
    },
  ])
})

it('continues to a reset after a failed save without retrying the failed write', async () => {
  const update = vi.fn(async () => {
    throw new Error('Offline')
  })
  const { view, reset } = settings({ updatePreference: action(update) })
  const save = view.savePreference(CATEGORY, 'email', { enabled: false })
  const resetting = view.resetToDefault(CATEGORY, [PROPERTY])
  await expect(save).resolves.toBe(false)
  await resetting
  expect(update).toHaveBeenCalledOnce()
  expect(reset).toHaveBeenCalledExactlyOnceWith({
    data: { propertyId: PROPERTY, category: CATEGORY },
  })
  expect(toast.error).toHaveBeenCalledWith(
    "Couldn't update that notification preference. Try again.",
  )
  expect(toast.success).toHaveBeenCalledWith('This property now follows your default')
})

it('keeps the own setting after a failed reset when a later save changes only its switch', async () => {
  const { view, update } = settings({
    resetPropertyCategory: action(async () => {
      throw new Error('Offline')
    }),
  })
  const reset = view.resetToDefault(CATEGORY, [PROPERTY])
  const save = view.savePreference(CATEGORY, 'email', { enabled: false })
  await Promise.all([reset, save])
  expect(update).toHaveBeenCalledExactlyOnceWith({
    data: {
      propertyId: PROPERTY,
      category: CATEGORY,
      channel: 'email',
      enabled: false,
      cadence: 'immediate',
    },
  })
  expect(toast.error).toHaveBeenCalledWith("Couldn't reset to your default. Try again.")
})

it('reports partial resets, skips later properties and rebases edits on the successful reset', async () => {
  const third = '10000000-0000-4000-8000-000000000004'
  const reset = vi.fn(async (input: Parameters<Props['resetPropertyCategory']>[0]) => {
    if (input.data.propertyId === OTHER) throw new Error('Access lost')
  })
  const { view, update } = settings({ resetPropertyCategory: action(reset) })
  const resetting = view.resetToDefault(CATEGORY, [PROPERTY, OTHER, third])
  const save = view.savePreference(CATEGORY, 'email', { enabled: true })
  await Promise.all([resetting, save])
  expect(reset.mock.calls.map(([input]) => input.data.propertyId)).toEqual([
    PROPERTY,
    OTHER,
  ])
  expect(update).toHaveBeenCalledExactlyOnceWith({
    data: {
      propertyId: PROPERTY,
      category: CATEGORY,
      channel: 'email',
      enabled: true,
      cadence: 'daily',
    },
  })
  expect(toast.error).toHaveBeenCalledWith(
    "1 of 3 properties now follow your default; the rest couldn't be reset. Try again.",
  )
})

it('allows another category to save while a reset is waiting', async () => {
  const held = deferred()
  const { view, update } = settings({ resetPropertyCategory: action(() => held.promise) })
  const reset = view.resetToDefault(CATEGORY, [PROPERTY])
  await expect(
    view.savePreference('arrivals', 'in_app', { enabled: true }),
  ).resolves.toBe(true)
  expect(update).toHaveBeenCalledExactlyOnceWith({
    data: {
      propertyId: PROPERTY,
      category: 'arrivals',
      channel: 'in_app',
      enabled: true,
      cadence: 'daily',
    },
  })
  held.resolve()
  await reset
})

it('makes only in-app the default when email is unavailable', async () => {
  const { view, update } = settings({ emailAvailability: 'unavailable' })
  await view.applyToAll(CATEGORY)
  expect(update).toHaveBeenCalledExactlyOnceWith({
    data: {
      propertyId: PROPERTY,
      category: CATEGORY,
      channel: 'in_app',
      enabled: true,
      cadence: 'daily',
      applyToAllProperties: true,
    },
  })
  expect(toast.success).toHaveBeenCalledWith(
    'In-app is now your default; email is not enabled here',
  )
})

it('retains a newly saved default through a queued reset and subsequent edit', async () => {
  const held = deferred()
  const inputs: Parameters<Props['updatePreference']>[0][] = []
  const { view } = settings({
    updatePreference: action(async (input) => {
      inputs.push(input)
      if (inputs.length === 1) await held.promise
      return row(input)
    }),
  })
  const apply = view.applyToAll(CATEGORY)
  const reset = view.resetToDefault(CATEGORY, [PROPERTY])
  const save = view.savePreference(CATEGORY, 'email', { enabled: false })
  held.resolve()
  await Promise.all([apply, reset, save])
  expect(inputs.map((input) => input.data)).toEqual([
    {
      propertyId: PROPERTY,
      category: CATEGORY,
      channel: 'in_app',
      enabled: true,
      cadence: 'daily',
      applyToAllProperties: true,
    },
    {
      propertyId: PROPERTY,
      category: CATEGORY,
      channel: 'email',
      enabled: true,
      cadence: 'immediate',
      applyToAllProperties: true,
    },
    {
      propertyId: PROPERTY,
      category: CATEGORY,
      channel: 'email',
      enabled: false,
      cadence: 'immediate',
    },
  ])
})

it('reports a partial default save and still runs the queued reset', async () => {
  const events: string[] = []
  const { view } = settings({
    updatePreference: action(async (input) => {
      events.push(input.data.channel)
      if (input.data.channel === 'email') throw new Error('Access lost')
      return row(input)
    }),
    resetPropertyCategory: action(async () => {
      events.push('reset')
    }),
  })
  await Promise.all([view.applyToAll(CATEGORY), view.resetToDefault(CATEGORY, [OTHER])])
  expect(events).toEqual(['in_app', 'email', 'reset'])
  expect(toast.error).toHaveBeenCalledWith(
    'In-app is now your default; email could not be saved',
  )
})

it('keeps an inherited low-rating threshold when editing after a reset', async () => {
  const held = deferred()
  const categoryDefault = createNotificationCategoryDefault(
    {
      userId: userId('person'),
      organizationId: organizationId('organization'),
      category: 'low_ratings',
      channel: 'email',
      enabled: false,
      cadence: 'daily',
      maxRating: 4,
    },
    () => new Date('2026-09-23T10:00:00Z'),
  )._unsafeUnwrap()
  const { view, update } = settings({
    preferences: [
      row({
        data: {
          propertyId: PROPERTY,
          category: 'low_ratings',
          channel: 'email',
          enabled: true,
          cadence: 'immediate',
          maxRating: 2,
        },
      }),
    ],
    categoryDefaults: [categoryDefault],
    resetPropertyCategory: action(() => held.promise),
  })
  const reset = view.resetToDefault('low_ratings', [PROPERTY])
  const save = view.savePreference('low_ratings', 'email', { enabled: true })
  held.resolve()
  await Promise.all([reset, save])
  expect(update).toHaveBeenCalledExactlyOnceWith({
    data: {
      propertyId: PROPERTY,
      category: 'low_ratings',
      channel: 'email',
      enabled: true,
      cadence: 'daily',
      maxRating: 4,
    },
  })
})

it('keeps earlier requested values in a queued edit even when the first save fails', async () => {
  const inputs: Parameters<Props['updatePreference']>[0][] = []
  const { view } = settings({
    updatePreference: action(async (input) => {
      inputs.push(input)
      if (inputs.length === 1) throw new Error('Offline')
      return row(input)
    }),
  })
  const disable = view.savePreference(CATEGORY, 'email', { enabled: false })
  const daily = view.savePreference(CATEGORY, 'email', { cadence: 'daily' })
  await expect(disable).resolves.toBe(false)
  await expect(daily).resolves.toBe(true)
  expect(inputs[1]?.data).toEqual({
    propertyId: PROPERTY,
    category: CATEGORY,
    channel: 'email',
    enabled: false,
    cadence: 'daily',
  })
})
