// The reply-template server functions (list and load), called as signed-in
// members over PostgreSQL with the real tenant resolution, execution policy and
// Review API. A rating-only Review needs no language provider, so the built-in
// templates the Property's default reply language selects are listed and loaded
// for real. The library rules sit in the use-case suites; this file holds the
// boundary: who may call, the strict inputs, and what a load writes.

import { describe, expect, it, vi } from 'vitest'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'
import { REVIEW_SEED_TABLES } from '#/shared/testing/server-function-review-seeds'
import type { TestReview } from '#/shared/testing/server-function-review-seeds'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { listReplyTemplatesFn, loadReplyTemplateFn } from './reply-templates'

const harness = setupServerFunctionHarness({
  cleanupTables: [
    'reply_publication_attempts',
    'reply_publication_authorizations',
    ...REVIEW_SEED_TABLES,
  ],
})

const TARGET = { kind: 'property_default' } as const

async function hotel(defaultReplyLanguage: string | null = 'en-Latn') {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const property = await harness.seedProperty(organization, {
    defaultReplyLanguage: 'en-Latn',
  })
  if (defaultReplyLanguage === null) {
    await harness
      .pool()
      .query(`UPDATE properties SET default_reply_language = NULL WHERE id = $1`, [
        property.id,
      ])
  }
  await harness.grantProperty(manager, property)
  const review = await harness.seedReview(property, { rating: 4, text: null })
  await harness.seedInboxItem({ review })
  return { organization, admin, manager, property, review }
}

async function storedReplies(review: TestReview) {
  const { rows } = await harness.pool().query<{
    status: string
    text: string
    template_ref: string | null
    template_revision: number | null
  }>(
    `SELECT status, text, template_ref, template_revision
       FROM replies WHERE review_id = $1`,
    [review.id],
  )
  return rows
}

async function listed(caller: Parameters<typeof harness.callAs>[0], review: TestReview) {
  return harness.callAs(caller, () =>
    listReplyTemplatesFn({ data: { reviewId: review.id, targetLanguage: TARGET } }),
  )
}

describe('reply-template server functions', () => {
  it('are POST mutations', () => {
    expect(listReplyTemplatesFn).toHaveProperty('method', 'POST')
    expect(loadReplyTemplateFn).toHaveProperty('method', 'POST')
  })

  it('refuse extra review text on list and a non-UUID template on load, before the caller is resolved', async () => {
    const { review } = await hotel()

    await expect(
      harness.callAs(null, (): Promise<unknown> =>
        listReplyTemplatesFn({
          data: {
            reviewId: review.id,
            targetLanguage: TARGET,
            reviewText: 'must not cross',
          } as never,
        }),
      ),
    ).rejects.toThrow(/reviewText|unrecognized/i)
    await expect(
      harness.callAs(null, (): Promise<unknown> =>
        loadReplyTemplateFn({
          data: { reviewId: review.id, templateId: 'not-a-uuid', targetLanguage: TARGET },
        }),
      ),
    ).rejects.toThrow(/templateId/)
  })
})

describe('listReplyTemplatesFn', () => {
  it('lists the built-in templates for the review language group to an AccountAdmin', async () => {
    const { admin, review } = await hotel()

    const result = await listed(admin, review)

    expect(result.profile).toBeNull()
    expect(result.groups).toEqual([
      expect.objectContaining({
        languageGroup: 'en-Latn',
        templates: expect.arrayContaining([
          expect.objectContaining({ layer: 'builtin' }),
        ]),
      }),
    ])
    expect(result.groups[0]!.templates.length).toBeGreaterThan(0)
  })

  it('lists to a PropertyManager the Property was granted to', async () => {
    const { manager, review } = await hotel()

    const result = await listed(manager, review)

    expect(result.groups[0]!.templates.length).toBeGreaterThan(0)
  })

  it('lists nothing when the Property has no default reply language', async () => {
    const { admin, review } = await hotel(null)

    const result = await listed(admin, review)

    expect(result.groups).toEqual([])
  })

  it('refuses a PropertyManager without a grant on the Property', async () => {
    const { organization, review } = await hotel()
    const outsider = await harness.seedMember(organization, 'PropertyManager')

    await expect(listed(outsider, review)).rejects.toMatchObject({
      name: 'ReviewError',
      status: 403,
    })
  })

  it('refuses a member whose role has no beta manager access and a caller with no session', async () => {
    const { organization, review } = await hotel()
    const member = await harness.seedMember(organization, 'Member')

    await expect(listed(member, review)).rejects.toMatchObject({
      code: 'beta_role_inactive',
    })
    await expect(listed(null, review)).rejects.toMatchObject({
      code: 'unauthorized',
      status: 401,
    })
  })

  it('does not find the review for an AccountAdmin of another Organization', async () => {
    const { review } = await hotel()
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    await expect(listed(otherAdmin, review)).rejects.toMatchObject({
      name: 'ReviewError',
      code: 'review_not_found',
      status: 404,
    })
  })
})

describe('loadReplyTemplateFn', () => {
  async function firstListedRef(
    caller: Parameters<typeof harness.callAs>[0],
    review: TestReview,
  ) {
    const result = await listed(caller, review)
    return result.groups[0]!.templates[0]!.ref
  }

  it('turns a listed template into the stored draft, carrying its reference and revision', async () => {
    const { manager, review } = await hotel()
    const ref = await firstListedRef(manager, review)

    const draft = await harness.callAs(manager, () =>
      loadReplyTemplateFn({
        data: { reviewId: review.id, templateId: ref, targetLanguage: TARGET },
      }),
    )

    expect(draft).toMatchObject({
      reviewId: review.id,
      status: 'draft',
      templateRef: ref,
      templateRevision: expect.any(Number),
    })
    expect(await storedReplies(review)).toEqual([
      expect.objectContaining({
        status: 'draft',
        text: draft.text,
        template_ref: ref,
        template_revision: draft.templateRevision,
      }),
    ])
  })

  it('refuses a template that is not among the listed ones and writes nothing', async () => {
    const { admin, review } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        loadReplyTemplateFn({
          data: {
            reviewId: review.id,
            templateId: crypto.randomUUID(),
            targetLanguage: TARGET,
          },
        }),
      ),
    ).rejects.toMatchObject({ name: 'ReviewError', status: 400 })
    expect(await storedReplies(review)).toEqual([])
  })

  it('refuses a PropertyManager without a grant and writes nothing', async () => {
    const { organization, admin, review } = await hotel()
    const ref = await firstListedRef(admin, review)
    const outsider = await harness.seedMember(organization, 'PropertyManager')

    await expect(
      harness.callAs(outsider, () =>
        loadReplyTemplateFn({
          data: { reviewId: review.id, templateId: ref, targetLanguage: TARGET },
        }),
      ),
    ).rejects.toMatchObject({ name: 'ReviewError', status: 403 })
    expect(await storedReplies(review)).toEqual([])
  })

  it('refuses a member without beta manager access, no session and another Organization', async () => {
    const { organization, admin, review } = await hotel()
    const ref = await firstListedRef(admin, review)
    const member = await harness.seedMember(organization, 'Member')
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')
    const load = (caller: Parameters<typeof harness.callAs>[0]) =>
      harness.callAs(caller, () =>
        loadReplyTemplateFn({
          data: { reviewId: review.id, templateId: ref, targetLanguage: TARGET },
        }),
      )

    await expect(load(member)).rejects.toMatchObject({ code: 'beta_role_inactive' })
    await expect(load(null)).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
    await expect(load(otherAdmin)).rejects.toMatchObject({
      code: 'review_not_found',
      status: 404,
    })
    expect(await storedReplies(review)).toEqual([])
  })
})
