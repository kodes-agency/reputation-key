// BQC-7.3 — seeded protected canaries never appear in logs.
//
// The sync-property-reviews job's invalid-identity branch is the canary class:
// it USED to dump the raw job payload (provider-derived locationName) into
// the log object. Canary payloads are driven through that exact path with a
// capturing logger attached; the canary must appear in NO emitted log field
// value (and no message). The metrics-side pin (OperationsSnapshot carries
// no tenant identifiers) lives in shared/architecture/observability-canary.

import { describe, it, expect, vi, beforeEach } from 'vitest'

type LogCall = Readonly<{ level: string; obj: unknown; msg?: unknown }>
const calls: LogCall[] = []

vi.mock('#/shared/observability/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/shared/observability/logger')>()
  const record =
    (level: string) =>
    (obj: unknown, msg?: unknown): void => {
      calls.push({ level, obj, msg })
    }
  const logger = {
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    debug: record('debug'),
    fatal: record('fatal'),
    trace: record('trace'),
    child: () => logger,
  }
  return { ...actual, getLogger: () => logger }
})

import { createSyncPropertyReviewsHandler } from './sync-property-reviews.job'

const CANARY = 'CANARY-SECRET-Acme-Dental-Suite-9f8e7d6c'

describe('canary: protected content never reaches log emission (BQC-7.3)', () => {
  beforeEach(() => {
    calls.length = 0
  })

  it('the raw job payload (provider locationName) appears in no log field', async () => {
    const handler = createSyncPropertyReviewsHandler({
      runSnapshot: vi.fn(async () => {
        throw new Error('must not be called — the identity gate runs first')
      }),
      propertyRouting: {
        getProcessingScope: vi.fn(async () => null),
      },
      enqueueContinuation: vi.fn(async () => undefined),
      syncActivity: {
        recordNewReviewObserved: vi.fn(async () => undefined),
        recordPushObserved: vi.fn(async () => undefined),
      },
      clock: () => new Date('2026-08-21T12:00:00.000Z'),
      hotIntervalMs: 15 * 60 * 1000,
    })

    // Invalid property/connection UUIDs → the identity error path that USED to log jobData.
    await expect(
      handler({
        id: 'job-canary-1',
        name: 'sync-property-reviews',
        data: {
          propertyId: 'not-a-uuid',
          organizationId: 'org-canary',
          connectionId: 'also-not-a-uuid',
          locationName: CANARY,
        },
      } as never),
    ).rejects.toThrow('Invalid Review provider snapshot job identity')

    const serialized = JSON.stringify(calls.map((c) => [c.obj, c.msg]))
    expect(serialized).not.toContain(CANARY)
    // And no tenant/entity identifier from the payload leaks either.
    expect(serialized).not.toContain('org-canary')
    expect(serialized).not.toContain('job-canary-1')
  })

  it('the sync failure path logs the error, never the payload', async () => {
    const handler = createSyncPropertyReviewsHandler({
      runSnapshot: vi.fn(async () => {
        throw new Error(CANARY)
      }),
      propertyRouting: {
        getProcessingScope: vi.fn(async () => ({
          processingRegion: 'global',
          sourceEpoch: 1,
        })),
      },
      enqueueContinuation: vi.fn(async () => undefined),
      syncActivity: {
        recordNewReviewObserved: vi.fn(async () => undefined),
        recordPushObserved: vi.fn(async () => undefined),
      },
      clock: () => new Date('2026-08-21T12:00:00.000Z'),
      hotIntervalMs: 15 * 60 * 1000,
    })

    const VALID_UUID = '123e4567-e89b-42d3-a456-426614174000'
    const VALID_ORGANIZATION_ID = '0UM0PoDLJNJ3yGCeBMERaQkQyxer9BuC'
    await expect(
      handler({
        id: 'job-canary-2',
        name: 'sync-property-reviews',
        data: {
          propertyId: VALID_UUID,
          organizationId: VALID_ORGANIZATION_ID,
          connectionId: VALID_UUID,
          locationName: 'CANARY-LOCATION-NAME-NEVER-LOGGED',
        },
      } as never),
    ).rejects.toThrow(CANARY)

    const serialized = JSON.stringify(calls.map((c) => [c.obj, c.msg]))
    expect(serialized).not.toContain('CANARY-LOCATION-NAME-NEVER-LOGGED')
  })
})
