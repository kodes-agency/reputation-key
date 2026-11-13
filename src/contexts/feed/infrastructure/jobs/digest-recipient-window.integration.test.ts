// When the digest is sent, measured in the recipient's own timezone, and the
// preferences link it carries, against real PostgreSQL.

import { afterEach, describe, expect, it } from 'vitest'
import { setQuietHours } from './digest-retry-seed'
import { openDigestWorld, PROP_A, type DigestWorld } from './digest-job-test-deps'

let world: DigestWorld | undefined

afterEach(async () => {
  await world?.rollBack()
  world = undefined
})

const open = async (options: Parameters<typeof openDigestWorld>[0] = {}) => {
  world = await openDigestWorld(options)
  return world
}

describe('digest timing in the recipient timezone', () => {
  it('uses the user timezone for the 08:00 window, not UTC', async () => {
    // 12:00Z is 08:00 in New York on a DST date: in window for the user even
    // though it is midday UTC.
    const w = await open({
      now: new Date('2026-07-11T12:00:00.000Z'),
      userTimezone: 'America/New_York',
    })
    const deps = w.deps()

    await w.run(deps)

    expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
  })

  it('does not send outside the recipient window', async () => {
    const w = await open({
      now: new Date('2026-07-11T08:00:00.000Z'),
      userTimezone: 'America/New_York',
    })
    const deps = w.deps()

    await w.run(deps)

    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  // US DST 2026 starts Sunday 8 March: 13:00Z is 08:00 EST on the 7th but
  // 09:00 EDT on the 8th.
  it('respects DST: the same UTC hour is in window before the shift', async () => {
    const w = await open({
      now: new Date('2026-03-07T13:00:00.000Z'),
      userTimezone: 'America/New_York',
    })
    const deps = w.deps()

    await w.run(deps)

    expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
  })

  it('respects DST: the same UTC hour is out of window after the shift', async () => {
    const w = await open({
      now: new Date('2026-03-08T13:00:00.000Z'),
      userTimezone: 'America/New_York',
    })
    const deps = w.deps()

    await w.run(deps)

    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  // US DST 2026 ends Sunday 1 November: 12:00Z is 08:00 EDT on the 31st of
  // October but 07:00 EST on the 1st, and 13:00Z is 08:00 EST.
  it('respects DST ending: 08:00 local is a different UTC hour after the clocks go back', async () => {
    const before = await open({
      now: new Date('2026-10-31T12:00:00.000Z'),
      userTimezone: 'America/New_York',
    })
    const beforeDeps = before.deps()
    await before.run(beforeDeps)
    expect(beforeDeps.emailSender.send).toHaveBeenCalledTimes(1)
    await before.rollBack()

    const after = await open({
      now: new Date('2026-11-01T12:00:00.000Z'),
      userTimezone: 'America/New_York',
    })
    const earlyDeps = after.deps()
    await after.run(earlyDeps)
    expect(earlyDeps.emailSender.send).not.toHaveBeenCalled()
    await after.rollBack()

    const onTime = await open({
      now: new Date('2026-11-01T13:00:00.000Z'),
      userTimezone: 'America/New_York',
    })
    const onTimeDeps = onTime.deps()
    await onTime.run(onTimeDeps)
    expect(onTimeDeps.emailSender.send).toHaveBeenCalledTimes(1)
  })

  // Sofia moves clocks forward on Sunday 29 March 2026: 05:00Z is 07:00 EET
  // the day before and 08:00 EEST after it.
  it('respects DST starting in a European zone: 08:00 local is an hour earlier in UTC afterwards', async () => {
    const w = await open({
      now: new Date('2026-03-29T05:00:00.000Z'),
      userTimezone: 'Europe/Sofia',
    })
    const deps = w.deps()

    await w.run(deps)

    expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
  })

  it('holds the same UTC hour back the day before Sofia’s clocks move', async () => {
    const w = await open({
      now: new Date('2026-03-28T05:00:00.000Z'),
      userTimezone: 'Europe/Sofia',
    })
    const deps = w.deps()

    await w.run(deps)

    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('keys the local date on the recipient timezone across a UTC date boundary', async () => {
    // 03:30Z on the 12th is still 23:30 on the 11th in New York. Outside the
    // 08:00 window only quiet-hours-parked rows are eligible, and releasing
    // one must use the recipient's date: keying on UTC would let the same
    // digest send twice across midnight.
    const w = await open({
      now: new Date('2026-07-12T03:30:00.000Z'),
      userTimezone: 'America/New_York',
      entries: false,
    })
    await w.entry({ property: PROP_A, status: 'delayed' })
    const deps = w.deps()

    await w.run(deps)

    expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
    expect(await w.batches()).toEqual([
      expect.objectContaining({ localDate: '2026-07-11' }),
    ])
  })

  it('falls back to the organization timezone when the user never chose one', async () => {
    const w = await open({
      now: new Date('2026-07-11T12:00:00.000Z'),
      userTimezone: null,
    })
    const deps = w.deps({ orgTimezone: 'America/New_York' })

    await w.run(deps)

    expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
  })

  it('defers on quiet hours measured in the recipient timezone', async () => {
    const w = await open()
    await setQuietHours(w, '07:00', '09:00')
    const deps = w.deps()

    await w.run(deps)

    expect(deps.emailSender.send).not.toHaveBeenCalled()
    for (const entry of w.entries) {
      expect(await w.email(entry)).toMatchObject({ status: 'delayed' })
    }
    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'quiet_hours', timezone: 'UTC' }),
      'Digest deferred',
    )
  })

  // Quiet hours once lived on each Property's row, so a person who set them
  // on one of two Properties had that Property deferred and the other mailed.
  // One person, one window, one digest.
  it('sends one digest for every Property when the person has quiet hours that are not now', async () => {
    const w = await open()
    await setQuietHours(w, '22:00', '06:00')
    const deps = w.deps()

    await w.run(deps)

    expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
    const payload = deps.emailSender.send.mock.calls[0]![0]
    expect(payload.html).toContain('Riverside')
    expect(payload.html).toContain('Hillcrest')
  })

  it('holds a multi-Property digest whole rather than sending half of it', async () => {
    const w = await open()
    await setQuietHours(w, '07:00', '09:00')
    const deps = w.deps()

    await w.run(deps)

    // Both Properties' rows wait for the same minute, so the next sweep still
    // finds one digest instead of two halves of one.
    const until = await Promise.all(
      w.entries.map(async (entry) => (await w.email(entry)).notBefore),
    )
    expect(until[0]).toBeInstanceOf(Date)
    expect(until[1]).toEqual(until[0])
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })
})

describe('digest preferences link', () => {
  it('sets List-Unsubscribe and the one-click directive', async () => {
    const w = await open()
    const deps = w.deps()

    await w.run(deps)

    expect(deps.emailSender.send.mock.calls[0]![0].headers).toEqual({
      'List-Unsubscribe': expect.stringMatching(
        /^<https:\/\/app\.example\.com\/api\/notifications\/unsubscribe\?token=v1-digest-[^>]+>$/,
      ),
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    })
  })

  it('refuses to send when the base URL cannot form an absolute preferences link', async () => {
    const w = await open()
    const deps = w.deps()
    deps.baseUrl = ''

    await w.run(deps)

    expect(deps.emailSender.send).not.toHaveBeenCalled()
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.anything() }),
      'Daily digest failed for recipient',
    )
    expect(await w.batches()).toHaveLength(0)
  })
})
