import { describe, expect, it } from 'vitest'
import type { NotificationChannel } from '#/contexts/feed/application/public-api'
import {
  applyEverywhereNotice,
  applyEverywhereInOrder,
} from './notification-apply-everywhere'

const saved = async () => undefined
const refused = async () => {
  throw new Error('capability_denied')
}

describe('applyEverywhereInOrder', () => {
  it('leaves email alone while the Property in view cannot send it', async () => {
    const calls: NotificationChannel[] = []

    const outcome = await applyEverywhereInOrder(false, async (channel) => {
      calls.push(channel)
    })

    expect(calls).toEqual(['in_app'])
    expect(outcome).toEqual({ applied: ['in_app'], failed: null, skipped: ['email'] })
  })

  it('says which channel was already applied when a later one fails', async () => {
    const outcome = await applyEverywhereInOrder(true, (channel) =>
      channel === 'email' ? refused() : saved(),
    )

    expect(outcome).toEqual({ applied: ['in_app'], failed: 'email', skipped: [] })
  })
})

describe('applyEverywhereNotice', () => {
  it('reports a whole success plainly', () => {
    expect(
      applyEverywhereNotice({ applied: ['in_app', 'email'], failed: null, skipped: [] }),
    ).toEqual({ tone: 'success', message: 'Applied to every property' })
  })

  it('does not call a half-applied answer a failure', () => {
    expect(
      applyEverywhereNotice({ applied: ['in_app'], failed: 'email', skipped: [] }),
    ).toEqual({
      tone: 'error',
      message: 'In-app was applied to every property; email could not be applied',
    })
  })

  it('names the channel it left alone', () => {
    expect(
      applyEverywhereNotice({ applied: ['in_app'], failed: null, skipped: ['email'] }),
    ).toEqual({
      tone: 'success',
      message: 'In-app applied to every property; email is not enabled here',
    })
  })

  it('reports nothing applied when the first save fails', () => {
    expect(applyEverywhereNotice({ applied: [], failed: 'in_app', skipped: [] })).toEqual(
      { tone: 'error', message: 'Could not apply to every property' },
    )
  })
})
