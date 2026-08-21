// `waitFor`'s failure message is the contract under test here, not its success
// path. A probe signals "not ready" by returning null, so on timeout the helper
// has no value in hand — and for 34 call sites it reported nothing but the
// description. In CI that made "the background worker was still working" and
// "the background worker is wedged" produce byte-identical failures, which is
// why the Google import spec was re-run rather than diagnosed five times.

import { describe, it, expect, vi } from 'vitest'
import { waitFor, bailWait, WaitBailedError } from './fixtures'

describe('waitFor', () => {
  it('returns the first truthy probe value without waiting for the deadline', async () => {
    const probe = vi.fn(async () => 'ready' as const)
    const started = Date.now()

    await expect(waitFor(probe, { timeoutMs: 5_000, description: 'x' })).resolves.toBe(
      'ready',
    )

    expect(probe).toHaveBeenCalledTimes(1)
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it('polls until the probe turns truthy', async () => {
    let calls = 0
    const value = await waitFor(
      async () => {
        calls += 1
        return calls < 3 ? null : { status: 'completed' }
      },
      { timeoutMs: 5_000, intervalMs: 1, description: 'eventual completion' },
    )

    expect(value).toEqual({ status: 'completed' })
    expect(calls).toBe(3)
  })

  it('reports the diagnosed state on timeout, so a stuck probe names what it saw', async () => {
    // The exact shape the import spec hits: the probe only ever says "not yet".
    await expect(
      waitFor(async () => null, {
        timeoutMs: 20,
        intervalMs: 5,
        description: 'v2 import to reach completed',
        diagnose: async () => ({ status: 'running', counts: { imported: 0 } }),
      }),
    ).rejects.toThrow(/last observed: \{"status":"running","counts":\{"imported":0\}\}/)
  })

  it('counts the probes it made, distinguishing a stalled probe from a slow subject', async () => {
    const err = await waitFor(async () => null, {
      timeoutMs: 30,
      intervalMs: 5,
      description: 'never ready',
    }).catch((e: unknown) => e as Error)

    // Without the count, one probe in 30ms and thirty probes in 30ms are the
    // same message — the first means the probe itself is blocking.
    expect(err.message).toMatch(/across [1-9]\d* probe\(s\)/)
  })

  it('surfaces a throwing probe as the last error', async () => {
    await expect(
      waitFor(
        async () => {
          throw new Error('ECONNREFUSED 127.0.0.1:3000')
        },
        { timeoutMs: 20, intervalMs: 5, description: 'server fn' },
      ),
    ).rejects.toThrow(/last error: Error: ECONNREFUSED/)
  })

  it('keeps the real timeout visible when diagnose itself fails', async () => {
    // A diagnostic that throws must not replace the failure it was explaining.
    const err = await waitFor(async () => null, {
      timeoutMs: 20,
      intervalMs: 5,
      description: 'v2 import to reach completed',
      diagnose: async () => {
        throw new Error('status endpoint 503')
      },
    }).catch((e: unknown) => e as Error)

    expect(err.message).toContain('v2 import to reach completed')
    expect(err.message).toContain('diagnose failed: Error: status endpoint 503')
  })
})

describe('bailWait', () => {
  it('aborts immediately instead of polling to the deadline', async () => {
    // The Google import case: the subject settled at a terminal status the
    // caller was not waiting for, so no amount of further polling can help.
    const started = Date.now()
    let probes = 0

    const err = await waitFor(
      async () => {
        probes += 1
        bailWait('v2 import', {
          status: 'completed_with_issues',
          counts: { cancelled: 1 },
        })
      },
      { timeoutMs: 10_000, intervalMs: 5, description: 'v2 import to reach completed' },
    ).catch((e: unknown) => e as Error)

    expect(err).toBeInstanceOf(WaitBailedError)
    expect(err.message).toContain('completed_with_issues')
    // The whole point: one probe, not 10s of them.
    expect(probes).toBe(1)
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it('does not treat an ordinary probe error as a bail', async () => {
    // A transient error must still be retried — otherwise every blip becomes fatal.
    let probes = 0
    await expect(
      waitFor(
        async () => {
          probes += 1
          throw new Error('ECONNRESET')
        },
        { timeoutMs: 30, intervalMs: 5, description: 'transient' },
      ),
    ).rejects.toThrow(/timed out/)
    expect(probes).toBeGreaterThan(1)
  })
})
