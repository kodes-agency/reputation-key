// In-memory MyBusinessNotificationsPort fake — for use in use case tests.
// Records every subscribe/unsubscribe call so tests can assert lifecycle
// behavior, and keeps each account's notification setting so a subscribe that
// finds the desired state already in place answers `already_subscribed`, as the
// governed adapter's read-first does.

import type {
  GbpAccountSubscription,
  MyBusinessNotificationsPort,
  SubscribeInput,
  UnsubscribeInput,
} from '#/contexts/integration/application/ports/mybusiness-notifications.port'

type Setting = Readonly<{ pubsubTopic: string; notificationTypes: readonly string[] }>

export type InMemoryMyBusinessNotificationsPort = MyBusinessNotificationsPort &
  Readonly<{
    subscribeCalls: ReadonlyArray<SubscribeInput>
    unsubscribeCalls: ReadonlyArray<UnsubscribeInput>
    setError: (operation: 'subscribe' | 'unsubscribe', error: Error) => void
    /** Fail only this account's subscribe. */
    setAccountError: (gbpAccountId: string, error: Error) => void
    /** Pretend Google already publishes this account to a topic. */
    seedSetting: (gbpAccountId: string, setting: Setting) => void
    reset: () => void
  }>

const sameSetting = (current: Setting, input: SubscribeInput): boolean =>
  current.pubsubTopic === input.pubsubTopic &&
  current.notificationTypes.length === input.notificationTypes.length &&
  input.notificationTypes.every((type) => current.notificationTypes.includes(type))

export const createInMemoryMyBusinessNotificationsPort =
  (): InMemoryMyBusinessNotificationsPort => {
    let subscribeCalls: SubscribeInput[] = []
    let unsubscribeCalls: UnsubscribeInput[] = []
    const errors = new Map<'subscribe' | 'unsubscribe', Error>()
    const accountErrors = new Map<string, Error>()
    const settings = new Map<string, Setting>()

    return {
      subscribe: async (input): Promise<GbpAccountSubscription> => {
        const err = errors.get('subscribe') ?? accountErrors.get(input.gbpAccountId)
        if (err) throw err
        subscribeCalls = [...subscribeCalls, input]
        const current = settings.get(input.gbpAccountId)
        if (current && sameSetting(current, input)) return 'already_subscribed'
        settings.set(input.gbpAccountId, {
          pubsubTopic: input.pubsubTopic,
          notificationTypes: [...input.notificationTypes],
        })
        return 'subscribed'
      },
      unsubscribe: async (input) => {
        const err = errors.get('unsubscribe')
        if (err) throw err
        unsubscribeCalls = [...unsubscribeCalls, input]
        settings.delete(input.gbpAccountId)
      },

      // ── Test-only helpers ───────────────────────────────────────────

      get subscribeCalls() {
        return subscribeCalls
      },
      get unsubscribeCalls() {
        return unsubscribeCalls
      },
      setError: (operation, error) => {
        errors.set(operation, error)
      },
      setAccountError: (gbpAccountId, error) => {
        accountErrors.set(gbpAccountId, error)
      },
      seedSetting: (gbpAccountId, setting) => {
        settings.set(gbpAccountId, setting)
      },
      reset: () => {
        subscribeCalls = []
        unsubscribeCalls = []
        errors.clear()
        accountErrors.clear()
        settings.clear()
      },
    }
  }
