// BQC-3.9 — inbox handler registration under per-family cutover states.
//
// record-only (production default): every bus handler registers — the bus is
// the primary projection path. shadow: every handler STILL registers (both
// paths run; the harness compares outcomes). switch: the switched family's
// bus handlers are NOT registered — the durable path is authoritative and the
// legacy primary is retired for that family (flag-gated, never deleted).

import { describe, it, expect, vi } from 'vitest'
import type { EventBus } from '#/shared/events/event-bus'
import type { CutoverFamily, CutoverState } from '#/shared/outbox/cutover-flags'
import { registerInboxHandlers } from './index'
import type { RegisterInboxHandlersDeps } from './index'

function recordingBus() {
  const registrations: Array<{ tag: string; consumer?: string }> = []
  const events: EventBus = {
    on: (tag, _handler, opts) => {
      registrations.push({ tag, consumer: opts?.consumer })
    },
    emit: async () => {},
    clear: () => {},
  }
  return { events, registrations }
}

function depsFor(
  events: EventBus,
  cutoverState?: (family: CutoverFamily) => CutoverState,
): RegisterInboxHandlersDeps {
  return {
    events,
    createInboxItem: vi.fn() as unknown as RegisterInboxHandlersDeps['createInboxItem'],
    repo: {} as RegisterInboxHandlersDeps['repo'],
    ...(cutoverState ? { cutoverState } : {}),
  }
}

const ALL_TAGS = [
  'review.created',
  'guest.feedback.submitted',
  'review.reply.published',
  'review.reply.submitted',
  'review.expired',
]

describe('registerInboxHandlers cutover wiring (BQC-3.9)', () => {
  it('registers every bus handler by default (record-only)', () => {
    const { events, registrations } = recordingBus()
    registerInboxHandlers(depsFor(events))
    expect(registrations.map((r) => r.tag)).toEqual(ALL_TAGS)
    expect(registrations.every((r) => r.consumer === 'inbox.event-handlers')).toBe(true)
  })

  it('keeps every handler registered when families are shadow (both paths run)', () => {
    const { events, registrations } = recordingBus()
    registerInboxHandlers(depsFor(events, () => 'shadow'))
    expect(registrations.map((r) => r.tag)).toEqual(ALL_TAGS)
  })

  it('skips the switched family bus handlers (legacy path retired)', () => {
    const { events, registrations } = recordingBus()
    registerInboxHandlers(
      depsFor(events, (family) =>
        family === 'review.created' ? 'switch' : 'record-only',
      ),
    )
    expect(registrations.map((r) => r.tag)).toEqual([
      'guest.feedback.submitted',
      'review.reply.published',
      'review.reply.submitted',
      'review.expired',
    ])
  })

  it('skips only durable-covered families — reply.submitted/feedback stay regardless', () => {
    const { events, registrations } = recordingBus()
    // Every cutover family switched: the non-cutover registrations remain.
    registerInboxHandlers(depsFor(events, () => 'switch'))
    expect(registrations.map((r) => r.tag)).toEqual([
      'guest.feedback.submitted',
      'review.reply.submitted',
    ])
  })

  it('mixed states: shadow families keep handlers, switch families drop them', () => {
    const { events, registrations } = recordingBus()
    registerInboxHandlers(
      depsFor(events, (family) => {
        if (family === 'review.created') return 'shadow'
        if (family === 'review.expired') return 'switch'
        return 'record-only'
      }),
    )
    expect(registrations.map((r) => r.tag)).toEqual([
      'review.created',
      'guest.feedback.submitted',
      'review.reply.published',
      'review.reply.submitted',
    ])
  })
})
