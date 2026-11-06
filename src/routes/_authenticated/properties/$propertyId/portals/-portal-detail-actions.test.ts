import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { createRouteHarness } from '#/routes/route-harness'
import { portalKeys } from '#/shared/queries/query-keys'
import { usePortalDetailActions } from './-portal-detail-actions'
import * as portals from '#/contexts/portal/server/portals'
import * as look from '#/contexts/portal/server/portal-look'
import * as print from '#/contexts/portal/server/portal-print-final'
import { updatePortalResponsibleManagers } from '#/contexts/portal/server/portal-responsible-managers'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('#/contexts/portal/server/portals', () => ({
  completeContentReview: vi.fn(),
  approvePortalApprovedDestination: vi.fn(),
  disablePortalApprovedDestination: vi.fn(),
  issuePortalToken: vi.fn(),
  requestPortalApprovedDestination: vi.fn(),
  revokePortalTokens: vi.fn(),
  revealPortalAddress: vi.fn(),
  rotatePortalToken: vi.fn(),
  rollbackPortalPublication: vi.fn(),
  savePortalLocalizedOverride: vi.fn(),
  savePropertyPortalBrandContent: vi.fn(),
  updatePortal: vi.fn(),
}))
vi.mock('#/contexts/portal/server/portal-responsible-managers', () => ({
  updatePortalResponsibleManagers: vi.fn(),
}))

vi.mock('#/contexts/portal/server/portal-look', () => ({
  savePortalLookColours: vi.fn(),
  savePortalLookIdentity: vi.fn(),
  savePortalLookPhoto: vi.fn(),
}))
vi.mock('#/contexts/portal/server/portal-print-final', () => ({
  downloadPortalPrintFinal: vi.fn(),
  savePortalPrintWording: vi.fn(),
}))

vi.mock('#/contexts/portal/server/portal-publish-changes', () => ({
  publishPortalChanges: vi.fn(),
}))

const PROPERTY_ID = 'property-1'
const PORTAL_ID = 'portal-1'
const scope = { propertyId: PROPERTY_ID, portalId: PORTAL_ID }
type Actions = ReturnType<typeof usePortalDetailActions>

const lookWrites = [
  {
    name: 'colours',
    command: look.savePortalLookColours,
    input: { data: { ...scope, colours: { mode: 'inherit' } } },
    run: (a: Actions) =>
      a.look.saveColours({ data: { ...scope, colours: { mode: 'inherit' } } }),
  },
  {
    name: 'identity',
    command: look.savePortalLookIdentity,
    input: { data: { ...scope, identity: { mode: 'inherit' } } },
    run: (a: Actions) =>
      a.look.saveIdentity({ data: { ...scope, identity: { mode: 'inherit' } } }),
  },
  {
    name: 'photo',
    command: look.savePortalLookPhoto,
    input: { data: { ...scope, photo: { mode: 'inherit' } } },
    run: (a: Actions) =>
      a.look.savePhoto({ data: { ...scope, photo: { mode: 'inherit' } } }),
  },
]
const contentWrites = [
  {
    name: 'localized content',
    command: portals.savePortalLocalizedOverride,
    run: (a: Actions) =>
      a.experience.saveOverride({
        data: {
          portalId: PORTAL_ID,
          locale: 'en',
          title: 'Welcome',
          shortDescription: null,
        },
      }),
  },
  {
    name: 'property content',
    command: portals.savePropertyPortalBrandContent,
    run: (a: Actions) =>
      a.experience.saveContent({
        data: {
          ...scope,
          locale: 'en',
          title: 'Welcome',
          shortDescription: 'A place to stay',
        },
      }),
  },
]

describe('Portal detail actions', () => {
  let harness: Awaited<ReturnType<typeof createRouteHarness>>
  let actions: Actions
  beforeEach(async () => {
    vi.resetAllMocks()
    harness = await createRouteHarness()
    actions = harness.renderHook(() => usePortalDetailActions(PROPERTY_ID, PORTAL_ID))
  })
  const seed = (keys: ReadonlyArray<readonly unknown[]>) => {
    for (const key of keys) harness.queryClient.setQueryData(key, { saved: 'before' })
  }
  const expectStale = (keys: ReadonlyArray<readonly unknown[]>) => {
    for (const key of keys) {
      expect(harness.queryClient.getQueryState(key)?.isInvalidated, String(key)).toBe(
        true,
      )
    }
  }

  it('saves a portal patch silently and refreshes detail, coverage and lists', async () => {
    const keys = [
      portalKeys.detail(PORTAL_ID),
      portalKeys.languageCoverage(PROPERTY_ID, PORTAL_ID),
      portalKeys.links(PORTAL_ID),
      portalKeys.list(PROPERTY_ID),
      portalKeys.publicationHistory(PORTAL_ID),
    ]
    seed(keys)
    const input = { data: { portalId: PORTAL_ID, name: 'New name' } }
    await actions.autosaveUpdate(input)
    expect(portals.updatePortal).toHaveBeenCalledExactlyOnceWith(input)
    expectStale(keys)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('rolls back a refused optimistic portal edit', async () => {
    const key = portalKeys.detail(PORTAL_ID)
    const previous = { portal: { id: PORTAL_ID, name: 'Original' } }
    harness.queryClient.setQueryData(key, previous)
    let reject!: (error: Error) => void
    vi.mocked(portals.updatePortal).mockImplementationOnce(
      () =>
        new Promise((_resolve, refused) => {
          reject = refused
        }),
    )
    const saving = actions.autosaveUpdate({
      data: { portalId: PORTAL_ID, name: 'Edited' },
    })
    await vi.waitFor(() =>
      expect(harness.queryClient.getQueryData(key)).toMatchObject({
        portal: { name: 'Edited' },
      }),
    )
    const failure = new Error('Save refused')
    const rejected = expect(saving).rejects.toBe(failure)
    reject(failure)
    await rejected
    expect(harness.queryClient.getQueryData(key)).toEqual(previous)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it.each(contentWrites)(
    'refreshes language coverage after $name',
    async ({ run, command }) => {
      const key = portalKeys.languageCoverage(PROPERTY_ID, PORTAL_ID)
      seed([key])
      await run(actions)
      expect(command).toHaveBeenCalledOnce()
      expectStale([key])
    },
  )

  it('refreshes every History descendant, list and overview after making a version live again', async () => {
    const keys = [
      portalKeys.detail(PORTAL_ID),
      portalKeys.historyFor(PORTAL_ID, 'all'),
      portalKeys.versions(PORTAL_ID),
      portalKeys.version(PORTAL_ID, 4),
      portalKeys.list(PROPERTY_ID),
      portalKeys.overview(PROPERTY_ID),
    ]
    seed(keys)
    await actions.makeVersionLive({ data: { portalId: PORTAL_ID, version: 4 } })
    expectStale(keys)
    expect(toast.success).toHaveBeenCalledOnce()
  })

  it('refreshes the managers of the submitted Portal on refusal, leaving the open Portal alone', async () => {
    const submitted = portalKeys.responsibleManagers('portal-2')
    const open = portalKeys.responsibleManagers(PORTAL_ID)
    seed([submitted, open])
    const refusal = new Error('Managers changed')
    vi.mocked(updatePortalResponsibleManagers).mockRejectedValueOnce(refusal)
    await expect(
      actions.updateResponsibleManagers({
        data: { portalId: 'portal-2', managerUserIds: [], expectedRevision: 5 },
      }),
    ).rejects.toBe(refusal)
    expectStale([submitted])
    expect(harness.queryClient.getQueryState(open)?.isInvalidated).toBe(false)
  })

  it('refreshes the detail and responsible managers after their save', async () => {
    const keys = [portalKeys.detail(PORTAL_ID), portalKeys.responsibleManagers(PORTAL_ID)]
    seed(keys)
    await actions.updateResponsibleManagers({
      data: { portalId: PORTAL_ID, managerUserIds: [], expectedRevision: 5 },
    })
    expectStale(keys)
  })

  it.each(lookWrites)(
    'refreshes all draft and publication reads after saving $name silently',
    async ({ run, command, input }) => {
      const keys = [
        portalKeys.languageCoverage(PROPERTY_ID, PORTAL_ID),
        portalKeys.experience(PROPERTY_ID, PORTAL_ID),
        portalKeys.preview(PORTAL_ID, 'draft'),
        portalKeys.publicationHistory(PORTAL_ID),
        portalKeys.review(PORTAL_ID),
        portalKeys.printKit(PORTAL_ID),
        portalKeys.overview(PROPERTY_ID),
        portalKeys.propertyExperience(PROPERTY_ID),
        portalKeys.lookReview(PROPERTY_ID),
      ]
      seed(keys)
      const unrelated = portalKeys.detail('another-portal')
      seed([unrelated])
      await run(actions)
      expect(command).toHaveBeenCalledExactlyOnceWith(input)
      expectStale(keys)
      expect(harness.queryClient.getQueryState(unrelated)?.isInvalidated).toBe(false)
      expect(toast.success).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
    },
  )

  it.each(lookWrites)(
    'propagates a refused $name save without invalidating or toasting',
    async ({ run, command, input }) => {
      const key = portalKeys.experience(PROPERTY_ID, PORTAL_ID)
      seed([key])
      const refusal = new Error('Save refused')
      vi.mocked(command).mockRejectedValueOnce(refusal)
      await expect(run(actions)).rejects.toBe(refusal)
      expect(command).toHaveBeenCalledExactlyOnceWith(input)
      expect(harness.queryClient.getQueryState(key)?.isInvalidated).toBe(false)
      expect(toast.error).not.toHaveBeenCalled()
    },
  )

  it.each([
    {
      name: 'download',
      command: print.downloadPortalPrintFinal,
      input: {
        data: {
          portalId: PORTAL_ID,
          piece: 'counter',
          orientation: 'upright',
          look: 'paper',
          printer: 'my_printer',
          quantity: 1,
          languages: ['en'],
          callToAction: 'how_did_we_do',
        },
      },
      run: (a: Actions) =>
        a.downloadPrintFinal({
          data: {
            portalId: PORTAL_ID,
            piece: 'counter',
            orientation: 'upright',
            look: 'paper',
            printer: 'my_printer',
            quantity: 1,
            languages: ['en'],
            callToAction: 'how_did_we_do',
          },
        }),
    },
    {
      name: 'wording',
      command: print.savePortalPrintWording,
      input: { data: { portalId: PORTAL_ID, callToAction: 'how_did_we_do' } },
      run: (a: Actions) =>
        a.savePrintWording({
          data: { portalId: PORTAL_ID, callToAction: 'how_did_we_do' },
        }),
    },
  ])(
    'sends $name to its command and reports a refusal once',
    async ({ command, run, input }) => {
      const refusal = new Error('Print refused')
      vi.mocked(command).mockRejectedValueOnce(refusal)
      await expect(run(actions)).rejects.toBe(refusal)
      expect(command).toHaveBeenCalledExactlyOnceWith(input)
      expect(toast.error).toHaveBeenCalledOnce()
      expect(toast.success).not.toHaveBeenCalled()
    },
  )
})
