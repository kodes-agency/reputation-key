import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CANARY_METRICS_PATH,
  createCanarySampleReader,
  observeCanaryWindowUsage,
  runObserveCanaryWindowCli,
} from './observe-canary-window'
import { releaseEvidenceSha256 } from '../../src/shared/release/candidate-bound-evidence'
import {
  CANARY_THRESHOLD_PROFILE_AUTHORITY_PATH,
  parseCanaryThresholdProfile,
} from '../../src/shared/release/canary-threshold-profile'

const PRODUCTION_ORIGIN = 'https://us.reputationkey.app'
const MANIFEST = '{"version":"repkey-promotion-manifest-1"}\n'
const MANIFEST_SHA256 = releaseEvidenceSha256(MANIFEST)
const RELEASE_SHA = 'a'.repeat(40)

function workspace(): string {
  return mkdtempSync(join(tmpdir(), 'repkey-canary-'))
}

function baseArgs(
  dir: string,
  overrides: Readonly<Record<string, string>> = {},
): readonly string[] {
  const flags: Record<string, string> = {
    '--app-origin': PRODUCTION_ORIGIN,
    '--release-sha': RELEASE_SHA,
    '--release-manifest': join(dir, 'manifest.json'),
    '--release-manifest-sha256': MANIFEST_SHA256,
    '--project-id': 'project-id',
    '--environment-id': 'environment-id',
    '--output': join(dir, 'canary-window.json'),
    ...overrides,
  }
  return Object.entries(flags).map(([flag, value]) => `${flag}=${value}`)
}

function silentIo() {
  const written: string[] = []
  return {
    io: {
      out: (line: string) => written.push(line),
      err: (line: string) => written.push(line),
    },
    written,
  }
}

describe('observe-canary-window CLI', () => {
  it('refuses any origin that is not the production cell-us origin', async () => {
    const dir = workspace()
    writeFileSync(join(dir, 'manifest.json'), MANIFEST)
    for (const origin of [
      'https://staging.reputationkey.app',
      'http://localhost:3000',
      'https://us.reputationkey.app.evil.example',
      'https://eu.reputationkey.app',
    ]) {
      const { io, written } = silentIo()
      const code = await runObserveCanaryWindowCli(
        baseArgs(dir, { '--app-origin': origin }),
        { io },
      )
      expect(code, origin).toBe(2)
      expect(written.join('\n')).toContain(PRODUCTION_ORIGIN)
    }
  })

  it('refuses any retry flag — a canary window is never re-run to green', async () => {
    const dir = workspace()
    writeFileSync(join(dir, 'manifest.json'), MANIFEST)
    for (const retryFlag of ['--retries', '--retries=2', '--retries=0']) {
      const { io, written } = silentIo()
      const code = await runObserveCanaryWindowCli([...baseArgs(dir), retryFlag], { io })
      expect(code, retryFlag).toBe(2)
      expect(written.join('\n')).toContain('--retries')
    }
  })

  it('refuses a candidate manifest digest that does not match the supplied manifest', async () => {
    const dir = workspace()
    writeFileSync(join(dir, 'manifest.json'), MANIFEST)
    const { io, written } = silentIo()
    const code = await runObserveCanaryWindowCli(
      baseArgs(dir, { '--release-manifest-sha256': 'b'.repeat(64) }),
      { io },
    )
    expect(code).toBe(2)
    expect(written.join('\n')).toContain(MANIFEST_SHA256)
  })

  it('refuses to overwrite an existing output artifact', async () => {
    const dir = workspace()
    writeFileSync(join(dir, 'manifest.json'), MANIFEST)
    const output = join(dir, 'canary-window.json')
    writeFileSync(output, '{"already":"here"}\n')
    const { io } = silentIo()
    const code = await runObserveCanaryWindowCli(baseArgs(dir), { io })
    expect(code).not.toBe(0)
    expect(readFileSync(output, 'utf8')).toBe('{"already":"here"}\n')
  })

  // The exclusive-create flag now lives in write-once.ts, so what this file has
  // to prove is that it never reaches around that helper to a raw write.
  it('creates its artifacts only through the write-once helper', () => {
    const source = readFileSync(
      resolve('scripts/release/observe-canary-window.ts'),
      'utf8',
    )
    expect(source).toContain("from '../../src/shared/release/write-once'")
    expect(source).not.toContain('writeFileSync')
  })

  it('refuses to observe while the window duration is an open operating decision', async () => {
    // Fed an OPEN profile explicitly. This used to lean on the SHIPPED profile
    // still being open, so ratifying the real 24-hour window silently turned
    // the control off. The refusal is the property worth keeping, so the test
    // now supplies the state it is testing instead of inheriting it.
    const dir = workspace()
    writeFileSync(join(dir, 'manifest.json'), MANIFEST)
    const openProfile = join(dir, 'open-profile.json')
    const shipped = JSON.parse(
      readFileSync(CANARY_THRESHOLD_PROFILE_AUTHORITY_PATH, 'utf8'),
    ) as Record<string, unknown>
    writeFileSync(
      openProfile,
      JSON.stringify(
        {
          ...shipped,
          ratification: {
            state: 'open',
            openDecisions: ['durationMs'],
            ratifyingRole: 'operating-owner',
            note: 'synthesized open profile for this control',
          },
        },
        null,
        2,
      ),
    )
    const { io, written } = silentIo()
    const code = await runObserveCanaryWindowCli(
      [...baseArgs(dir), `--profile=${openProfile}`],
      { io },
    )
    expect(code).toBe(1)
    expect(written.join('\n')).toContain('durationMs')
  })

  it('gets past the ratification check on the shipped 24-hour profile', () => {
    // The other half: the shipped profile must now actually be usable, or the
    // ratification would be a file nobody reads.
    const result = parseCanaryThresholdProfile(
      readFileSync(CANARY_THRESHOLD_PROFILE_AUTHORITY_PATH, 'utf8'),
      { now: '2026-08-30T00:00:00.000Z' },
    )

    expect(result.ok).toBe(true)
    if (!result.ok || result.state !== 'ratified') throw new Error('not ratified')
    expect(result.profile.durationMs).toBe(86_400_000)
  })

  it('documents its own usage without a retry option', () => {
    expect(observeCanaryWindowUsage()).not.toContain('--retries')
  })
})

describe('canary sample reader', () => {
  const signal = {
    name: 'canary-queue-outbox-backlog',
    category: 'queue_outbox',
    source: 'application_metrics',
    valuePointer: '/outbox/stalledLeaseCount',
    sampleIntervalMs: 60_000,
  } as const

  it('reads application metrics from the ops-token gated endpoint', async () => {
    const calls: Array<{ url: string; token: string | null; method: string }> = []
    const reader = createCanarySampleReader({
      appOrigin: PRODUCTION_ORIGIN,
      opsToken: 'ops-token-0123456789abcdef0123456789',
      endpoints: new Map(),
      fetchImpl: async (input, init) => {
        const request = new Request(input, init)
        calls.push({
          url: request.url,
          token: request.headers.get('x-ops-token'),
          method: request.method,
        })
        return new Response(
          JSON.stringify({
            outbox: { stalledLeaseCount: 0 },
            release: { sha: RELEASE_SHA },
            versions: { capabilityPolicy: 'cap-1' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      },
    })

    const reading = await reader({
      signal,
      sampleIndex: 0,
      scheduledAt: '2026-08-28T00:01:00.000Z',
    })

    expect(calls).toEqual([
      {
        url: `${PRODUCTION_ORIGIN}${CANARY_METRICS_PATH}`,
        token: 'ops-token-0123456789abcdef0123456789',
        method: 'GET',
      },
    ])
    expect(reading.ok).toBe(true)
    if (!reading.ok) return
    expect(reading.value).toBe(0)
    expect(reading.identity?.releaseSha).toBe(RELEASE_SHA)
    expect(reading.configurationHead).toContain('capabilityPolicy')
  })

  it('records the fail-closed 404 metrics gate as a missing sample, never a pass', async () => {
    const reader = createCanarySampleReader({
      appOrigin: PRODUCTION_ORIGIN,
      opsToken: 'ops-token-0123456789abcdef0123456789',
      endpoints: new Map(),
      fetchImpl: async () => new Response(null, { status: 404 }),
    })

    const reading = await reader({
      signal,
      sampleIndex: 0,
      scheduledAt: '2026-08-28T00:01:00.000Z',
    })

    expect(reading.ok).toBe(false)
    if (reading.ok) return
    expect(reading.reason).toContain('404')
  })

  it('records an unresolvable value pointer as a missing sample', async () => {
    const reader = createCanarySampleReader({
      appOrigin: PRODUCTION_ORIGIN,
      opsToken: 'ops-token-0123456789abcdef0123456789',
      endpoints: new Map(),
      fetchImpl: async () =>
        new Response(JSON.stringify({ outbox: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    })

    const reading = await reader({
      signal,
      sampleIndex: 0,
      scheduledAt: '2026-08-28T00:01:00.000Z',
    })

    expect(reading.ok).toBe(false)
    if (reading.ok) return
    expect(reading.reason).toContain(signal.valuePointer)
  })

  it('refuses a source with no configured endpoint rather than defaulting one', async () => {
    const reader = createCanarySampleReader({
      appOrigin: PRODUCTION_ORIGIN,
      opsToken: 'ops-token-0123456789abcdef0123456789',
      endpoints: new Map(),
      fetchImpl: async () => {
        throw new Error('no request may be made')
      },
    })

    const reading = await reader({
      signal: { ...signal, source: 'sentry', category: 'error_rate' },
      sampleIndex: 0,
      scheduledAt: '2026-08-28T00:01:00.000Z',
    })

    expect(reading.ok).toBe(false)
    if (reading.ok) return
    expect(reading.reason).toContain('sentry')
  })
})
