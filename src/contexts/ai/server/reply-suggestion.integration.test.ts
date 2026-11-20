// Reply suggestions, requested as signed-in members over PostgreSQL with the
// real tenant resolution, execution policy and reply drafting use case. A
// review with no AI consent answers with a local template or "unavailable".

import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { REPLY_TONES } from '#/shared/ai-reply-template-catalogue'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import {
  setupServerFunctionHarness,
  type TestMember,
  type TestReview,
} from '#/shared/testing/server-function-harness'
import { REVIEW_SEED_TABLES } from '#/shared/testing/server-function-review-seeds'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)
import { generateReplySuggestionFn } from './reply-suggestion'

const harness = setupServerFunctionHarness({ cleanupTables: REVIEW_SEED_TABLES })

/** Long enough for the review's language to be recognised. */
const REVIEW_WORDS =
  'The harbour view from our room was lovely, and the staff were very kind to us during our long stay.'

const NO_STORE = {
  'cache-control': 'private, no-store, max-age=0',
  pragma: 'no-cache',
  expires: '0',
}

async function hotel(options: { defaultReplyLanguage?: string } = {}) {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const property = await harness.seedProperty(organization, options)
  await harness.grantProperty(manager, property)
  const review = await harness.seedReview(property, { text: REVIEW_WORDS })
  return { organization, admin, manager, property, review }
}

function request(
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

const suggest = (
  caller: TestMember | null,
  review: Pick<TestReview, 'id'>,
  fields: Readonly<Record<string, unknown>> = {},
) =>
  harness.callAs(caller, () =>
    generateReplySuggestionFn({ data: request(review, fields) as never }),
  )

const suggestWithHeaders = (
  caller: TestMember | null,
  review: Pick<TestReview, 'id'>,
  fields: Readonly<Record<string, unknown>> = {},
) =>
  harness.respondAs(caller, () =>
    generateReplySuggestionFn({ data: request(review, fields) as never }),
  )

/** The capability store the app builds from its environment, swapped for one call. */
async function withCapabilityEnv<T>(
  env: Readonly<Record<string, string>>,
  call: () => Promise<T>,
): Promise<T> {
  initCapabilityPolicyStore(createEnvCapabilityPolicyStore(env))
  try {
    return await call()
  } finally {
    initCapabilityPolicyStore(harness.container().capabilityPolicyStore)
  }
}

describe('generateReplySuggestionFn: a local template', () => {
  it('gives an AccountAdmin the template of the review’s rating, named as requested', async () => {
    const { admin, review } = await hotel()

    const result = await suggest(admin, review, { templateOnly: true })

    expect(result).toMatchObject({
      status: 'fallback',
      kind: 'local_safe_template',
      reason: 'template_requested',
      languageSource: 'explicit',
      replyText: expect.any(String),
      concreteLanguageTag: expect.stringMatching(/^en/),
    })
  })

  it('gives a PropertyManager the Property was granted to the same template', async () => {
    const { manager, review } = await hotel()

    const result = await suggest(manager, review, { templateOnly: true })

    expect(result).toMatchObject({ status: 'fallback', kind: 'local_safe_template' })
  })

  it.each(REPLY_TONES)('renders a template in the %s tone', async (tone) => {
    const { admin, review } = await hotel()

    const result = await suggest(admin, review, { templateOnly: true, tone })

    expect(result).toMatchObject({ status: 'fallback', kind: 'local_safe_template' })
  })

  it('writes in the Property’s default language when asked to', async () => {
    const { admin, review } = await hotel({ defaultReplyLanguage: 'bg-Cyrl-BG' })

    const result = await suggest(admin, review, {
      templateOnly: true,
      targetLanguage: { kind: 'property_default' },
    })

    expect(result).toMatchObject({
      status: 'fallback',
      concreteLanguageTag: expect.stringMatching(/^bg/),
    })
  })

  it('answers that the target language is unavailable when the Property has no default', async () => {
    const { admin, review } = await hotel()

    const result = await suggest(admin, review, {
      templateOnly: true,
      targetLanguage: { kind: 'property_default' },
    })

    expect(result).toMatchObject({
      status: 'unavailable',
      code: 'target_language_unavailable',
    })
  })

  it('still answers a template while the AI capability is switched off', async () => {
    const { admin, review } = await hotel()

    const result = await withCapabilityEnv({ BETA_CAPABILITIES_OFF: 'ai' }, () =>
      suggest(admin, review, { templateOnly: true }),
    )

    expect(result).toMatchObject({ status: 'fallback', kind: 'local_safe_template' })
  })

  it('refuses a template while every capability is switched off', async () => {
    const { admin, review } = await hotel()

    await expect(
      withCapabilityEnv({ BETA_CAPABILITIES_OFF: 'all' }, () =>
        suggest(admin, review, { templateOnly: true }),
      ),
    ).rejects.toMatchObject({ code: 'capability_disabled', status: 403 })
  })

  it('refuses a template while the Organization is suspended', async () => {
    const { organization, admin, review } = await hotel()

    await expect(
      withCapabilityEnv({ BETA_SUSPENDED_ORGS: organization.id }, () =>
        suggest(admin, review, { templateOnly: true }),
      ),
    ).rejects.toMatchObject({ code: 'org_suspended', status: 403 })
  })
})

describe('generateReplySuggestionFn: an AI suggestion', () => {
  it('answers unavailable, not an error, while AI is not authorized for the Property', async () => {
    const { admin, review } = await hotel()

    const result = await suggest(admin, review)

    expect(result).toEqual({
      status: 'unavailable',
      code: 'not_authorized',
      retryAfterEpochMillis: null,
    })
  })

  it('answers the same to a PropertyManager the Property was granted to', async () => {
    const { manager, review } = await hotel()

    expect(await suggest(manager, review)).toMatchObject({ code: 'not_authorized' })
  })
})

describe('generateReplySuggestionFn: who may ask', () => {
  it.each([[{ templateOnly: true }], [{}]])(
    'refuses a PropertyManager the Property was not granted to (%j)',
    async (fields) => {
      const { organization, review } = await hotel()
      const outsider = await harness.seedMember(organization, 'PropertyManager')

      await expect(suggest(outsider, review, fields)).rejects.toMatchObject({
        code: 'scope_denied',
        status: 403,
      })
    },
  )

  it('refuses a member whose role has no beta manager access', async () => {
    const { organization, review } = await hotel()
    const member = await harness.seedMember(organization, 'Member')

    await expect(suggest(member, review)).rejects.toMatchObject({
      code: 'beta_role_inactive',
    })
  })

  it('refuses a caller with no session', async () => {
    const { review } = await hotel()

    await expect(suggest(null, review)).rejects.toMatchObject({
      code: 'unauthorized',
      status: 401,
    })
  })

  it('does not find a review that does not exist', async () => {
    const { admin } = await hotel()

    await expect(suggest(admin, { id: randomUUID() })).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
      message: 'Review not found',
    })
  })

  it('does not find a review of another Organization', async () => {
    const { review } = await hotel()
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    await expect(suggest(otherAdmin, review)).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
    })
  })
})

describe('generateReplySuggestionFn: AI content is never cached', () => {
  it('sets the no-store headers on an answer', async () => {
    const { admin, review } = await hotel()

    const response = await suggestWithHeaders(admin, review, { templateOnly: true })

    expect(response.ok).toBe(true)
    for (const [name, value] of Object.entries(NO_STORE)) {
      expect(response.headers.get(name)).toBe(value)
    }
  })

  it('sets them when the review is missing too', async () => {
    const { admin } = await hotel()

    const response = await suggestWithHeaders(admin, { id: randomUUID() })

    expect(response.ok).toBe(false)
    for (const [name, value] of Object.entries(NO_STORE)) {
      expect(response.headers.get(name)).toBe(value)
    }
  })
})

describe('generateReplySuggestionFn: input validation', () => {
  it.each([
    ['a reviewId that is not a UUID', { reviewId: 'nope' }, /reviewId/],
    ['a reviewId with SQL after it', { reviewId: `${randomUUID()} OR 1=1` }, /reviewId/],
    [
      'an idempotencyKey that is not a UUID',
      { idempotencyKey: 'retry-1' },
      /idempotencyKey/,
    ],
    ['an uncatalogued tone', { tone: 'shouty' }, /tone/],
    ['a missing idempotencyKey', { idempotencyKey: undefined }, /idempotencyKey/],
    ['a missing tone', { tone: undefined }, /tone/],
    ['a missing targetLanguage', { targetLanguage: undefined }, /targetLanguage/],
    [
      'a language tag the client chose',
      { targetLanguage: { kind: 'property_default', tag: 'bg-Cyrl-BG' } },
      /targetLanguage/,
    ],
  ])('refuses %s, and sets no header', async (_name, fields, message) => {
    const { admin, review } = await hotel()

    const response = await suggestWithHeaders(admin, review, fields)

    expect(response.ok).toBe(false)
    expect(String((response as { error: unknown }).error)).toMatch(message)
    expect(response.headers.get('cache-control')).toBeNull()
  })
})
