import { describe, expect, it } from 'vitest'
import { organizationId } from '#/shared/domain/ids'
import type { OperatorErasureAuthority } from './guest-response-lifecycle.server'
import {
  SESSION,
  harness,
  registerLifecycleSuiteHooks,
} from './guest-response-lifecycle.test-fixtures'

registerLifecycleSuiteHooks()

describe('operator erasure', () => {
  const allow: OperatorErasureAuthority = { verify: async (id) => id === 'operator-1' }

  it('erases after the withdrawal window and retracts the readings', async () => {
    let now = new Date('2026-08-09T12:00:00.000Z')
    const {
      scope,
      lifecycle,
      rawLifecycle,
      stored,
      outbox,
      keepSessionBound,
      journalWrites,
    } = await harness(() => now, allow)
    await lifecycle.submit(scope, SESSION, { rating: 3, responseConsent: true })
    const original = (await outbox.byTag('guest.rating.submitted'))[0]!
    await keepSessionBound()
    now = new Date('2026-08-12T12:00:00.000Z')
    await expect(lifecycle.withdraw(scope, SESSION)).rejects.toMatchObject({
      code: 'response_withdrawal_expired',
    })

    await expect(
      rawLifecycle.eraseAsOperator('operator-1', scope, (await stored()).id),
    ).resolves.toBe('erased')

    expect(await stored()).toMatchObject({ status: 'deleted', rating: null })
    expect(journalWrites).toHaveLength(1)
    expect(await outbox.byTag('guest.rating.retracted')).toMatchObject([
      { supersedesSourceEventId: original.eventId },
    ])
  })

  it.each([undefined, allow])(
    'writes nothing for a denied operator',
    async (authority) => {
      const { scope, lifecycle, rawLifecycle, stored, outbox } = await harness(
        undefined,
        authority,
      )
      await lifecycle.submit(scope, SESSION, { rating: 3, responseConsent: true })

      await expect(
        rawLifecycle.eraseAsOperator('someone-else', scope, (await stored()).id),
      ).rejects.toMatchObject({ code: 'operator_not_authorized' })

      expect(await stored()).toMatchObject({ status: 'submitted', rating: 3 })
      expect(await outbox.byTag('guest.rating.retracted')).toHaveLength(0)
    },
  )

  it('writes nothing for a subject outside the tenant scope', async () => {
    const { scope, lifecycle, rawLifecycle, stored, outbox } = await harness(
      undefined,
      allow,
    )
    await lifecycle.submit(scope, SESSION, { rating: 3, responseConsent: true })

    await expect(
      rawLifecycle.eraseAsOperator(
        'operator-1',
        { ...scope, organizationId: organizationId('other-org') },
        (await stored()).id,
      ),
    ).rejects.toMatchObject({ code: 'response_not_found' })

    expect(await stored()).toMatchObject({ status: 'submitted' })
    expect(await outbox.byTag('guest.rating.retracted')).toHaveLength(0)
  })

  it('is idempotent for an already erased response', async () => {
    const { scope, lifecycle, rawLifecycle, stored, outbox } = await harness(
      undefined,
      allow,
    )
    await lifecycle.submit(scope, SESSION, { rating: 3, responseConsent: true })
    const id = (await stored()).id
    await rawLifecycle.eraseAsOperator('operator-1', scope, id)

    await expect(rawLifecycle.eraseAsOperator('operator-1', scope, id)).resolves.toBe(
      'already_erased',
    )
    expect(await outbox.byTag('guest.rating.retracted')).toHaveLength(1)
  })
})
