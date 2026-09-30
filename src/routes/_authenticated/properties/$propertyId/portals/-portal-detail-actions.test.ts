// Every write that can close a language gap must refresh the language coverage
// read, or the Languages rows and the section list keep showing a stale count.
// The coverage key descends from the Portal's experience key, so one experience
// invalidation refreshes it; these tests pin that for each such write.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActionMutationOptions } from '#/components/hooks/use-action-mutation'
import { portalKeys } from '#/shared/queries/query-keys'

const PROPERTY_ID = 'property-1'
const PORTAL_ID = 'portal-1'

const captured = new Map<unknown, ActionMutationOptions<unknown, unknown> | undefined>()
const mutationOptions: Array<{ onSuccess?: () => Promise<void> | void }> = []
const invalidated: unknown[][] = []

vi.mock('#/components/hooks/use-action-mutation', () => ({
  useActionMutation: (fn: unknown, options?: ActionMutationOptions<unknown, unknown>) => {
    captured.set(fn, options)
    return {}
  },
}))
vi.mock('@tanstack/react-query', () => ({
  useMutation: (options: { onSuccess?: () => Promise<void> | void }) => {
    mutationOptions.push(options)
    return { mutateAsync: vi.fn(), isPending: false, error: null, isSuccess: false }
  },
  useQueryClient: () => ({
    invalidateQueries: async ({ queryKey }: { queryKey: unknown[] }) => {
      invalidated.push(queryKey)
    },
  }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))
vi.mock('#/contexts/portal/server/portals', () => ({
  completeContentReview: 'completeContentReview',
  approvePortalApprovedDestination: 'approvePortalApprovedDestination',
  disablePortalApprovedDestination: 'disablePortalApprovedDestination',
  issuePortalToken: 'issuePortalToken',
  requestPortalApprovedDestination: 'requestPortalApprovedDestination',
  revokePortalTokens: 'revokePortalTokens',
  rotatePortalToken: 'rotatePortalToken',
  savePortalLocalizedOverride: 'savePortalLocalizedOverride',
  savePropertyPortalBrandContent: 'savePropertyPortalBrandContent',
  savePropertyPortalBrandProfile: 'savePropertyPortalBrandProfile',
  updatePortal: vi.fn(),
}))
vi.mock('#/contexts/portal/server/portal-responsible-managers', () => ({
  updatePortalResponsibleManagers: 'updatePortalResponsibleManagers',
}))

import { usePortalDetailActions } from './-portal-detail-actions'

const coverageKey = portalKeys.languageCoverage(PROPERTY_ID, PORTAL_ID)

const refreshesCoverage = (keys: ReadonlyArray<readonly unknown[]>) =>
  keys.some((key) => key.every((part, index) => coverageKey[index] === part))

describe('portal detail actions and the language coverage read', () => {
  beforeEach(() => {
    captured.clear()
    mutationOptions.length = 0
    invalidated.length = 0
    usePortalDetailActions(PROPERTY_ID, PORTAL_ID)
  })

  it.each([
    'savePortalLocalizedOverride',
    'savePropertyPortalBrandContent',
    'savePropertyPortalBrandProfile',
  ])('refreshes the coverage after %s', (name) => {
    expect(refreshesCoverage(captured.get(name)?.invalidateKeys ?? [])).toBe(true)
  })

  it('refreshes the coverage after a portal update (a language added or removed)', async () => {
    const onSuccess = mutationOptions[0]?.onSuccess
    await onSuccess?.()
    expect(refreshesCoverage(invalidated)).toBe(true)
  })

  it('nests the coverage under the Portal experience and the Property experience', () => {
    expect(coverageKey.slice(0, -1)).toEqual(
      portalKeys.experience(PROPERTY_ID, PORTAL_ID),
    )
    expect(
      coverageKey.slice(0, portalKeys.propertyExperience(PROPERTY_ID).length),
    ).toEqual(portalKeys.propertyExperience(PROPERTY_ID))
  })
})
