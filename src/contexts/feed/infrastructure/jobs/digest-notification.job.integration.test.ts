// The daily digest job against real PostgreSQL: who is mailed, what the mail
// says, and what is left in the queue afterwards.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  openDigestWorld,
  PROP_A,
  PROP_B,
  USER,
  USER_2,
  type DigestWorld,
} from './digest-job-test-deps'

let world: DigestWorld

beforeEach(async () => {
  world = await openDigestWorld()
})

afterEach(async () => {
  await world.rollBack()
})

describe('digest notification job — one email per user (ADR 0046 r.4)', () => {
  it('sends exactly one digest to a multi-property user, grouped by property', async () => {
    const deps = world.deps()

    await world.run(deps)

    expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
    const payload = deps.emailSender.send.mock.calls[0]![0]
    expect(payload.html).toContain('Riverside')
    expect(payload.html).toContain('Hillcrest')
    expect(payload.text).toContain('Riverside')
    expect(payload.text).toContain('Hillcrest')
    for (const entry of world.entries) {
      expect(await world.email(entry)).toMatchObject({ status: 'accepted' })
    }
  })

  it('reads due rows per recipient, never per property', async () => {
    const deps = world.deps()

    await world.run(deps)

    // Both Properties' rows left in one batch, one member per row.
    const batches = await world.batches()
    expect(batches).toHaveLength(1)
    expect(batches[0]).toMatchObject({ organizationId: 'digest-job-org', userId: USER })
  })

  it('sends one digest per recipient when several are due', async () => {
    await world.entry({ property: PROP_A, user: USER_2 })
    const deps = world.deps()

    await world.run(deps)

    expect(deps.emailSender.send).toHaveBeenCalledTimes(2)
  })

  it('still authorizes every concrete property before including its rows', async () => {
    const deps = world.deps()
    deps.authorizeScope.mockImplementation(async (_org, property) => property === PROP_A)

    await world.run(deps)

    const payload = deps.emailSender.send.mock.calls[0]![0]
    expect(payload.html).toContain('Riverside')
    expect(payload.html).not.toContain('Hillcrest')
  })

  it('holds, and never mails, rows for a Property that is no longer active', async () => {
    // Archived after the rows were queued. Urgent mail for it is held; the
    // digest must agree rather than email notices about a removed Property.
    const deps = world.deps()
    deps.resolvePropertyScope.mockImplementation(async (org: string, property: string) =>
      property === PROP_B
        ? null
        : { organizationId: org, propertyId: property, timezone: 'UTC' },
    )

    await world.run(deps)

    const payload = deps.emailSender.send.mock.calls[0]![0]
    expect(payload.html).toContain('Riverside')
    expect(payload.html).not.toContain('Hillcrest')
    expect(await world.email(world.entries[1]!)).toMatchObject({ status: 'pending' })
    expect(await world.email(world.entries[0]!)).toMatchObject({ status: 'accepted' })
  })

  it('sends nothing when no property is authorized', async () => {
    const deps = world.deps()
    deps.authorizeScope.mockResolvedValue(false)

    await world.run(deps)

    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('keeps one bad recipient from aborting the sweep for everyone else', async () => {
    await world.entry({ property: PROP_A, user: USER_2 })
    const deps = world.deps()
    deps.userLookup.getName.mockRejectedValueOnce(new Error('identity read failed'))

    await world.run(deps)

    expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(Error) }),
      'Daily digest failed for recipient',
    )
  })
})

describe('digest subject and body', () => {
  it('carries a count and a date instead of a static subject', async () => {
    const deps = world.deps()

    await world.run(deps)

    const { subject } = deps.emailSender.send.mock.calls[0]![0]
    expect(subject).not.toBe('Your daily digest — Reputation Key')
    expect(subject).toMatch(/\d+ updates?/)
    expect(subject).toContain('July')
  })

  it('never emits the literal two-character backslash-n that joined the old items', async () => {
    // The old digestHtml did `items.join('\\n')` — a literal backslash + n,
    // rendered verbatim between every paragraph.
    const deps = world.deps()

    await world.run(deps)

    const { html, text } = deps.emailSender.send.mock.calls[0]![0]
    expect(html).not.toContain(String.raw`\n`)
    expect(text).not.toContain(String.raw`\n`)
  })

  it('renders from type + payload, never the stored raw-id title', async () => {
    const deps = world.deps()

    await world.run(deps)

    const { html, text, subject } = deps.emailSender.send.mock.calls[0]![0]
    for (const rendered of [html, text, subject]) {
      expect(rendered).not.toContain('61ed98fc')
    }
  })

  it('ships a plain-text twin', async () => {
    const deps = world.deps()

    await world.run(deps)

    expect(deps.emailSender.send.mock.calls[0]![0].text.length).toBeGreaterThan(0)
  })
})
