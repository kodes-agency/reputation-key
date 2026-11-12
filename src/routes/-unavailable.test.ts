import { describe, expect, it, vi } from 'vitest'
import { CAPABILITY_REFUSAL_CATEGORIES } from '#/shared/auth/capability-refusal-category'
import {
  resolveUnavailableAccountState,
  UNAVAILABLE_FEATURE_LABELS,
  unavailablePageContent,
  unavailableSearch,
} from './unavailable'

type Content = ReturnType<typeof unavailablePageContent>
const expectRecovery = (content: Content, to: '/accept-invitation' | '/properties') => {
  expect(content.title.trim()).not.toBe('')
  expect(content.description.trim()).not.toBe('')
  expect(content.link.label.trim()).not.toBe('')
  expect(content.link.to).toBe(to)
}

describe('unavailable route presentation', () => {
  it('gives waiting, removed and departed accounts distinct explanations and an invitation recovery path', () => {
    const search = { reason: 'workspace_access' } as const
    const states = [
      unavailablePageContent(search),
      unavailablePageContent(search, { accessRemoved: true }),
      unavailablePageContent(search, { accessRemoved: true, leftWorkspace: true }),
    ]
    for (const content of states) {
      expectRecovery(content, '/accept-invitation')
      expect(content.guidance?.trim()).toBeTruthy()
    }
    expect(states[1]?.description).toMatch(/administrator.*removed/i)
    expect(states[2]?.description).toMatch(/you left/i)
    expect(states[2]?.description).not.toMatch(/administrator/i)
    expect(new Set(states.map(({ title }) => title)).size).toBe(3)
    expect(new Set(states.map(({ description }) => description)).size).toBe(3)
    expect(new Set(states.map(({ guidance }) => guidance)).size).toBe(3)
    expect(unavailablePageContent(search, { accessRemoved: false })).toEqual(states[0])
  })

  it('ignores an access-removal record outside workspace recovery', () => {
    expect(
      unavailablePageContent({ feature: 'Recognition' }, { accessRemoved: true }),
    ).toEqual(unavailablePageContent({ feature: 'Recognition' }))
  })

  it.each(CAPABILITY_REFUSAL_CATEGORIES)(
    'gives %s its own explanation and the available next step',
    (category) => {
      const content = unavailablePageContent({ feature: 'Goals', category })
      expectRecovery(content, '/properties')
      expect(content.link).not.toHaveProperty('params')
    },
  )

  it('keeps different capability refusals distinguishable', () => {
    const titles = CAPABILITY_REFUSAL_CATEGORIES.map(
      (category) => unavailablePageContent({ feature: 'Goals', category }).title,
    )
    expect(new Set(titles).size).toBe(CAPABILITY_REFUSAL_CATEGORIES.length)
  })

  it('accepts every refusal category in the URL', () => {
    // The route's search schema once hardcoded three categories; a fourth
    // would have been stripped and the page fallen back to generic copy.
    for (const category of CAPABILITY_REFUSAL_CATEGORIES) {
      expect(unavailableSearch.parse({ category }).category).toBe(category)
    }
  })

  it('gives old links without a category a safe way back', () => {
    expectRecovery(unavailablePageContent({ feature: 'Recognition' }), '/properties')
  })

  // The page is public and its card wears the product's name, so the heading
  // must not be whatever a link's author typed into `?feature=`.
  it('drops a feature the product never named instead of printing it as the heading', () => {
    const typed =
      'Your account is locked. Call +359 2 000 0000 to restore it. Reputation Key'

    const search = unavailableSearch.parse({ feature: typed })

    expect(search.feature).toBeUndefined()
    const content = unavailablePageContent(search)
    expectRecovery(content, '/properties')
    expect(content.title).not.toContain(typed)
    expect(content).toEqual(unavailablePageContent({}))
  })

  it('still reads the label of every link the product issued', () => {
    for (const feature of UNAVAILABLE_FEATURE_LABELS) {
      expect(unavailableSearch.parse({ feature }).feature).toBe(feature)
    }
    // What the shell sends an account whose workspace is dark or has no role.
    expect(UNAVAILABLE_FEATURE_LABELS).toContain('Workspace')
  })

  // This is the page an account with no workspace recovers from, so an address
  // it cannot read must still draw it.
  it('drops a reason, a category or a property it cannot read', () => {
    expect(
      unavailableSearch.parse({ reason: 'expired', category: 'gone', propertyId: 7 }),
    ).toEqual({})
    expect(
      unavailablePageContent(unavailableSearch.parse({ category: 'gone' })).title,
    ).toBe(unavailablePageContent({}).title)
  })

  // A Property's id is a UUID, and this one becomes the link to its settings.
  it('drops a category an old link carries that the page no longer reads', () => {
    expect(
      unavailableSearch.parse({
        category: 'needs_admin_enablement',
        propertyId: '0b9d7c1a-3e5f-4b2a-8c6d-1e2f3a4b5c6d',
      }),
    ).toEqual({ category: undefined })
  })

  it('keeps the rest of the address when the feature is dropped', () => {
    expect(
      unavailableSearch.parse({ feature: 'x'.repeat(200), category: 'not_in_beta' }),
    ).toEqual({ category: 'not_in_beta' })
  })
})

describe('unavailable account state', () => {
  it('asks only on the workspace-access screen', async () => {
    const read = vi.fn(async () => ({ removedAt: '2026-09-20T09:00:00.000Z' }))

    await expect(
      resolveUnavailableAccountState('workspace_access', read),
    ).resolves.toEqual({ accessRemoved: true })
    await expect(resolveUnavailableAccountState(undefined, read)).resolves.toEqual({
      accessRemoved: false,
    })
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('passes on that the reader left rather than was removed', async () => {
    const read = vi.fn(async () => ({
      removedAt: '2026-09-20T09:00:00.000Z',
      left: true,
    }))

    await expect(
      resolveUnavailableAccountState('workspace_access', read),
    ).resolves.toEqual({ accessRemoved: true, leftWorkspace: true })
  })

  it('still renders the recovery screen when the read fails', async () => {
    const read = vi.fn(async () => {
      throw new Error('read unavailable')
    })

    await expect(
      resolveUnavailableAccountState('workspace_access', read),
    ).resolves.toEqual({ accessRemoved: false })
  })
})
