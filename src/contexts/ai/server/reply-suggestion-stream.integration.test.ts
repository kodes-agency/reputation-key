// Streaming reply suggestions, requested as signed-in members over PostgreSQL
// with the real tenant resolution, execution policy and reply drafting use
// case. A review with no AI consent is refused on the stream.

import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type * as RuntimeCapabilityModule from '#/shared/merchant-ai-notice/ai-runtime-capability-contract'
import {
  setupServerFunctionHarness,
  type TestMember,
  type TestReview,
} from '#/shared/testing/server-function-harness'
import { REVIEW_SEED_TABLES } from '#/shared/testing/server-function-review-seeds'

const servedSelection = vi.hoisted(() => ({
  operationProfileVersion: null as string | null,
}))

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)
// The catalogue serves one reply profile, so the other selection is only
// reachable by changing what the module answers for the length of one call.
vi.mock(
  '#/shared/merchant-ai-notice/ai-runtime-capability-contract',
  async (importOriginal) => {
    const actual = await importOriginal<typeof RuntimeCapabilityModule>()
    return {
      ...actual,
      getAiRuntimeCapability: ((
        capability: Parameters<typeof actual.getAiRuntimeCapability>[0],
      ) => {
        const served = actual.getAiRuntimeCapability(capability)
        return capability === 'reply_drafting' && servedSelection.operationProfileVersion
          ? {
              ...served,
              operationProfileVersion: servedSelection.operationProfileVersion,
            }
          : served
      }) as typeof actual.getAiRuntimeCapability,
    }
  },
)
import { generateReplySuggestionStreamFn } from './reply-suggestion-stream'

const harness = setupServerFunctionHarness({ cleanupTables: REVIEW_SEED_TABLES })

/** Long enough for the review's language to be recognised. */
const REVIEW_WORDS =
  'The harbour view from our room was lovely, and the staff were very kind to us during our long stay.'

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const property = await harness.seedProperty(organization)
  await harness.grantProperty(manager, property)
  const review = await harness.seedReview(property, { text: REVIEW_WORDS })
  return { organization, admin, manager, property, review }
}

function streamData(
  review: Pick<TestReview, 'id'>,
  fields: Readonly<Record<string, unknown>> = {},
) {
  return {
    reviewId: review.id,
    tone: 'professional',
    targetLanguage: { kind: 'review_language' },
    idempotencyKey: randomUUID(),
    ...fields,
  }
}

/** The response and its lines, read before the call's request ends. */
function stream(
  caller: TestMember | null,
  review: Pick<TestReview, 'id'>,
  fields: Readonly<Record<string, unknown>> = {},
) {
  return harness.callAs(caller, async () => {
    const response = await generateReplySuggestionStreamFn({
      data: streamData(review, fields) as never,
    })
    const lines = (await response.clone().text())
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    return { response, lines }
  })
}

describe('generateReplySuggestionStreamFn', () => {
  it('answers one refused line while AI is not authorized for the Property', async () => {
    const { admin, review } = await hotel()

    const { response, lines } = await stream(admin, review)

    expect(response.headers.get('content-type')).toContain('application/x-ndjson')
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(lines).toEqual([
      {
        step: 'refused',
        reason: 'not_authorized',
        retryAfterEpochMillis: null,
        sequence: 1,
      },
    ])
  })

  it('accepts optional options the client left undefined', async () => {
    const { admin, review } = await hotel()

    const { lines } = await stream(admin, review, {
      variation: undefined,
      length: undefined,
      maxWords: undefined,
    })

    expect(lines).toMatchObject([{ step: 'refused', reason: 'not_authorized' }])
  })

  it('answers a PropertyManager the Property was granted to the same way', async () => {
    const { manager, review } = await hotel()

    const { lines } = await stream(manager, review)

    expect(lines).toMatchObject([{ step: 'refused', reason: 'not_authorized' }])
  })

  it('turns a refusal into a quiet deferral for a background request', async () => {
    const { admin, review } = await hotel()

    const { lines } = await stream(admin, review, { intent: 'background' })

    expect(lines).toEqual([
      { step: 'deferred', retryAfterEpochMillis: null, sequence: 1 },
    ])
  })

  it('keeps the newer reply profile dark while the older one is served', async () => {
    const { admin, review } = await hotel()
    servedSelection.operationProfileVersion = 'reply-suggestion-v1'

    try {
      const { lines } = await stream(admin, review)

      expect(lines).toMatchObject([{ step: 'refused', reason: 'policy_unavailable' }])
    } finally {
      servedSelection.operationProfileVersion = null
    }
  })

  it('refuses a PropertyManager the Property was not granted to', async () => {
    const { organization, review } = await hotel()
    const outsider = await harness.seedMember(organization, 'PropertyManager')

    await expect(stream(outsider, review)).rejects.toMatchObject({
      code: 'scope_denied',
      status: 403,
    })
  })

  it('refuses a member whose role has no beta manager access', async () => {
    const { organization, review } = await hotel()
    const member = await harness.seedMember(organization, 'Member')

    await expect(stream(member, review)).rejects.toMatchObject({
      code: 'beta_role_inactive',
    })
  })

  it('refuses a caller with no session', async () => {
    const { review } = await hotel()

    await expect(stream(null, review)).rejects.toMatchObject({
      code: 'unauthorized',
      status: 401,
    })
  })

  it('does not find a review that does not exist', async () => {
    const { admin } = await hotel()

    await expect(stream(admin, { id: randomUUID() })).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
    })
  })

  it('does not find a review of another Organization', async () => {
    const { review } = await hotel()
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    await expect(stream(otherAdmin, review)).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
    })
  })

  it.each([
    ['an Organization id', { organizationId: 'other' }, /Unrecognized key/],
    ['a word limit without the short length', { maxWords: 20 }, /./],
    ['a word limit below the bound', { length: 'short', maxWords: 7 }, /./],
    ['a word limit above the bound', { length: 'short', maxWords: 81 }, /./],
  ])('refuses %s', async (_name, fields, message) => {
    const { admin, review } = await hotel()

    await expect(stream(admin, review, fields)).rejects.toThrow(message)
  })
})
