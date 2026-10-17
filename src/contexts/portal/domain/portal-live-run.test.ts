import { describe, expect, it } from 'vitest'
import { liveIntervals, liveRunStart, type LiveRunActivation } from './portal-live-run'

// Europe/Sofia is UTC+3 until Oct 25, 2026: 12:00 local is 09:00 UTC.
const at = (iso: string) => new Date(iso)

const activation = (
  activationSequence: number,
  activatedAt: string,
  closed: Readonly<{ at: string; reason: 'disabled' | 'archived' | 'replaced' }> | null,
): LiveRunActivation => ({
  activationSequence,
  activatedAt: at(activatedAt),
  deactivatedAt: closed ? at(closed.at) : null,
  deactivationReason: closed?.reason ?? null,
})

describe('portal live run', () => {
  it('a republish keeps the first go-live', () => {
    const activations = [
      activation(1, '2026-10-09T09:00:00.000Z', {
        at: '2026-10-12T15:30:00.000Z',
        reason: 'replaced',
      }),
      activation(2, '2026-10-12T15:30:00.000Z', null),
    ]

    expect(liveRunStart(activations)).toEqual(at('2026-10-09T09:00:00.000Z'))
    expect(
      liveIntervals(
        activations,
        at('2026-10-01T00:00:00.000Z'),
        at('2026-10-23T00:00:00.000Z'),
      ),
    ).toEqual([{ from: at('2026-10-09T09:00:00.000Z'), to: null }])
  })

  it('a rollback continues the run', () => {
    const activations = [
      activation(1, '2026-10-09T09:00:00.000Z', {
        at: '2026-10-12T15:30:00.000Z',
        reason: 'replaced',
      }),
      activation(2, '2026-10-12T15:30:00.000Z', {
        at: '2026-10-14T08:00:00.000Z',
        reason: 'replaced',
      }),
      // "Make live again" on version 1 appends a rollback activation.
      activation(3, '2026-10-14T08:00:00.000Z', null),
    ]

    expect(liveRunStart(activations)).toEqual(at('2026-10-09T09:00:00.000Z'))
  })

  it('a disable then publish starts a new run', () => {
    // G17: Reception live Oct 1, disabled Oct 10 14:00 to Oct 13 09:00 (Sofia).
    const activations = [
      activation(1, '2026-10-01T06:00:00.000Z', {
        at: '2026-10-10T11:00:00.000Z',
        reason: 'disabled',
      }),
      activation(2, '2026-10-13T06:00:00.000Z', null),
    ]

    expect(liveRunStart(activations)).toEqual(at('2026-10-13T06:00:00.000Z'))
    expect(
      liveIntervals(
        activations,
        at('2026-09-24T00:00:00.000Z'),
        at('2026-10-23T00:00:00.000Z'),
      ),
    ).toEqual([
      { from: at('2026-10-01T06:00:00.000Z'), to: at('2026-10-10T11:00:00.000Z') },
      { from: at('2026-10-13T06:00:00.000Z'), to: null },
    ])
  })

  it('archived or never published has no live run', () => {
    expect(liveRunStart([])).toBeNull()
    expect(
      liveRunStart([
        activation(1, '2026-10-01T06:00:00.000Z', {
          at: '2026-10-05T06:00:00.000Z',
          reason: 'replaced',
        }),
        activation(2, '2026-10-05T06:00:00.000Z', {
          at: '2026-10-10T06:00:00.000Z',
          reason: 'archived',
        }),
      ]),
    ).toBeNull()
    expect(
      liveRunStart([
        activation(1, '2026-10-01T06:00:00.000Z', {
          at: '2026-10-10T06:00:00.000Z',
          reason: 'disabled',
        }),
      ]),
    ).toBeNull()
    expect(
      liveIntervals([], at('2026-09-01T00:00:00.000Z'), at('2026-10-23T00:00:00.000Z')),
    ).toEqual([])
  })

  it('intervals clip to the window', () => {
    const activations = [
      // Entirely before the window.
      activation(1, '2026-08-01T06:00:00.000Z', {
        at: '2026-08-20T06:00:00.000Z',
        reason: 'disabled',
      }),
      // Ends exactly where the window starts: it does not overlap it.
      activation(2, '2026-08-25T06:00:00.000Z', {
        at: '2026-09-01T00:00:00.000Z',
        reason: 'disabled',
      }),
      // Straddles the window's start.
      activation(3, '2026-08-28T06:00:00.000Z', {
        at: '2026-09-05T06:00:00.000Z',
        reason: 'replaced',
      }),
      activation(4, '2026-09-05T06:00:00.000Z', {
        at: '2026-09-10T06:00:00.000Z',
        reason: 'disabled',
      }),
      // Still open: the interval keeps no end.
      activation(5, '2026-09-20T06:00:00.000Z', null),
    ]

    expect(
      liveIntervals(
        activations,
        at('2026-09-01T00:00:00.000Z'),
        at('2026-10-01T00:00:00.000Z'),
      ),
    ).toEqual([
      { from: at('2026-09-01T00:00:00.000Z'), to: at('2026-09-10T06:00:00.000Z') },
      { from: at('2026-09-20T06:00:00.000Z'), to: null },
    ])
    // A run that closed after the window ends is cut at the window's end, and a
    // run that starts after it is left out.
    expect(
      liveIntervals(
        activations,
        at('2026-09-01T00:00:00.000Z'),
        at('2026-09-08T00:00:00.000Z'),
      ),
    ).toEqual([
      { from: at('2026-09-01T00:00:00.000Z'), to: at('2026-09-08T00:00:00.000Z') },
    ])
  })

  it('a run older than the read keeps its first go-live from the boundary rows alone', () => {
    // What `listActivationsForPortals` returns for a Portal live since May and
    // republished in June: the run's first activation and the open one, without
    // the republish in between that closed before the read's window.
    const read = [
      activation(1, '2026-05-02T06:00:00.000Z', {
        at: '2026-05-20T06:00:00.000Z',
        reason: 'disabled',
      }),
      activation(2, '2026-05-25T06:00:00.000Z', {
        at: '2026-06-10T06:00:00.000Z',
        reason: 'replaced',
      }),
      activation(4, '2026-07-01T06:00:00.000Z', null),
    ]

    expect(liveRunStart(read)).toEqual(at('2026-05-25T06:00:00.000Z'))
    expect(liveRunStart([...read].reverse())).toEqual(at('2026-05-25T06:00:00.000Z'))
    expect(
      liveIntervals(read, at('2026-08-18T00:00:00.000Z'), at('2026-10-17T00:00:00.000Z')),
    ).toEqual([{ from: at('2026-08-18T00:00:00.000Z'), to: null }])
  })
})
