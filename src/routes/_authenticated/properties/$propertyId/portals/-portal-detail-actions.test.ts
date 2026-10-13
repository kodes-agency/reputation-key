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
const toasted: string[] = []

vi.mock('#/components/hooks/use-action-mutation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#/components/hooks/use-action-mutation')>()),
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
vi.mock('sonner', () => ({
  toast: { success: (message: string) => void toasted.push(message) },
}))
vi.mock('#/contexts/portal/server/portals', () => ({
  completeContentReview: 'completeContentReview',
  approvePortalApprovedDestination: 'approvePortalApprovedDestination',
  disablePortalApprovedDestination: 'disablePortalApprovedDestination',
  issuePortalToken: 'issuePortalToken',
  requestPortalApprovedDestination: 'requestPortalApprovedDestination',
  revokePortalTokens: 'revokePortalTokens',
  revealPortalAddress: 'revealPortalAddress',
  rotatePortalToken: 'rotatePortalToken',
  rollbackPortalPublication: 'rollbackPortalPublication',
  savePortalLocalizedOverride: 'savePortalLocalizedOverride',
  savePropertyPortalBrandContent: 'savePropertyPortalBrandContent',
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
  let actions: ReturnType<typeof usePortalDetailActions>

  beforeEach(() => {
    captured.clear()
    mutationOptions.length = 0
    invalidated.length = 0
    toasted.length = 0
    actions = usePortalDetailActions(PROPERTY_ID, PORTAL_ID)
  })

  // The page has one portal patch. A second copy that toasted "Portal updated"
  // was built beside it and handed to the page, where no component called it.
  it('builds one portal patch, with no second copy that nothing calls', () => {
    expect(mutationOptions).toHaveLength(1)
    expect(Object.keys(actions)).toContain('autosaveUpdate')
    expect(Object.keys(actions)).not.toContain('update')
  })

  // The header's save status is the patch's acknowledgement, for a section
  // that autosaves and for the language Save alike.
  it('acknowledges a portal patch in the header, never in a toast', async () => {
    await mutationOptions[0]?.onSuccess?.()

    expect(toasted).toEqual([])
    expect(invalidated).toContainEqual(portalKeys.detail(PORTAL_ID))
  })

  it.each(['savePortalLocalizedOverride', 'savePropertyPortalBrandContent'])(
    'refreshes the coverage after %s',
    (name) => {
      expect(refreshesCoverage(captured.get(name)?.invalidateKeys ?? [])).toBe(true)
    },
  )

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

  // Making a version live again changes what the header says is live, what the
  // History tab lists (both read under the detail key), and the overview.
  it('refreshes the detail, the list and the overview after making a version live again', () => {
    const keys = captured.get('rollbackPortalPublication')?.invalidateKeys ?? []

    expect(keys).toContainEqual(portalKeys.detail(PORTAL_ID))
    expect(keys).toContainEqual(portalKeys.list(PROPERTY_ID))
    expect(keys).toContainEqual(portalKeys.overview(PROPERTY_ID))
  })

  // A refused save means another admin changed the managers, and the card's
  // Reset can only show that once the page has read it. The Portal is the one
  // the command named: this hook's render may be for another Portal by then.
  it('re-reads the responsible managers of the Portal a refused save named', () => {
    const options = captured.get('updatePortalResponsibleManagers')

    options?.onError?.(new Error('responsible managers changed; reload them'), {
      data: { portalId: 'portal-2', managerUserIds: [], expectedRevision: 5 },
    })

    expect(invalidated).toEqual([portalKeys.responsibleManagers('portal-2')])
    expect(options?.invalidateKeys).toEqual([
      portalKeys.detail(PORTAL_ID),
      portalKeys.responsibleManagers(PORTAL_ID),
    ])
  })

  it('keeps the History reads under the detail key, so one refresh reaches them', () => {
    const detail = portalKeys.detail(PORTAL_ID)

    expect(portalKeys.historyFor(PORTAL_ID, 'all').slice(0, detail.length)).toEqual(
      detail,
    )
    expect(portalKeys.versions(PORTAL_ID).slice(0, detail.length)).toEqual(detail)
    expect(
      portalKeys.version(PORTAL_ID, 4).slice(0, portalKeys.versions(PORTAL_ID).length),
    ).toEqual(portalKeys.versions(PORTAL_ID))
  })
})
