// In-memory MyBusinessNotificationsPort fake — for use in use case tests.
// Records every subscribe/unsubscribe call so tests can assert lifecycle behavior.

import type {
  MyBusinessNotificationsPort,
  SubscribeInput,
  UnsubscribeInput,
} from '#/contexts/integration/application/ports/mybusiness-notifications.port'

export type InMemoryMyBusinessNotificationsPort = MyBusinessNotificationsPort &
  Readonly<{
    subscribeCalls: ReadonlyArray<SubscribeInput>
    unsubscribeCalls: ReadonlyArray<UnsubscribeInput>
    setError: (operation: 'subscribe' | 'unsubscribe', error: Error) => void
    reset: () => void
  }>

export const createInMemoryMyBusinessNotificationsPort =
  (): InMemoryMyBusinessNotificationsPort => {
    let subscribeCalls: SubscribeInput[] = []
    let unsubscribeCalls: UnsubscribeInput[] = []
    const errors = new Map<'subscribe' | 'unsubscribe', Error>()

    return {
      subscribe: async (input) => {
        const err = errors.get('subscribe')
        if (err) throw err
        subscribeCalls = [...subscribeCalls, input]
      },
      unsubscribe: async (input) => {
        const err = errors.get('unsubscribe')
        if (err) throw err
        unsubscribeCalls = [...unsubscribeCalls, input]
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
      reset: () => {
        subscribeCalls = []
        unsubscribeCalls = []
        errors.clear()
      },
    }
  }
