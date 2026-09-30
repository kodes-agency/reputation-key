// Every link tree edit changes the working copy, so every one must refresh the
// workspace header's "N changes not live" note. That note reads the publication
// history, not the links, so invalidating only the links left it stale.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActionMutationOptions } from '#/components/hooks/use-action-mutation'
import { portalKeys } from '#/shared/queries/query-keys'

const captured: Array<ActionMutationOptions<unknown, unknown> | undefined> = []

vi.mock('#/components/hooks/use-action-mutation', () => ({
  useActionMutation: (
    _fn: unknown,
    options?: ActionMutationOptions<unknown, unknown>,
  ) => {
    captured.push(options)
    return {}
  },
}))
vi.mock('#/contexts/portal/server/portal-links', () => ({
  createLinkCategory: vi.fn(),
  reorderCategories: vi.fn(),
  deleteLinkCategory: vi.fn(),
  createLink: vi.fn(),
  deleteLink: vi.fn(),
  updateLink: vi.fn(),
  updateLinkCategory: vi.fn(),
  reorderLinks: vi.fn(),
}))

import { useLinkTreeMutations } from './use-link-tree-mutations'

const PORTAL_ID = 'portal-1'

describe('useLinkTreeMutations invalidation', () => {
  beforeEach(() => {
    captured.length = 0
  })

  it('declares all eight mutations', () => {
    useLinkTreeMutations(PORTAL_ID)
    expect(captured).toHaveLength(8)
  })

  it('refreshes the links and the publication history after every mutation', () => {
    useLinkTreeMutations(PORTAL_ID)
    for (const options of captured) {
      expect(options?.invalidateKeys).toEqual(
        expect.arrayContaining([
          portalKeys.links(PORTAL_ID),
          portalKeys.publicationHistory(PORTAL_ID),
        ]),
      )
    }
  })
})
