import { describe, expect, it, vi } from 'vitest'
import type { Action } from '#/components/hooks/use-action'
import type {
  PortalApprovedDestinationList,
  PortalExperienceActions,
} from '../portal-settings/portal-experience-settings-types'
import { linkApprovalControls, siteControlsFor } from './link-approval-controls'

const action = (isPending = false) =>
  Object.assign(
    vi.fn(async () => undefined),
    { isPending, error: null, isSuccess: false, data: null },
  ) as unknown as Action<never>

const actions = (pending = false) =>
  ({
    saveContent: action(),
    saveOverride: action(),
    requestDestination: action(),
    approveDestination: action(pending),
    disableDestination: action(),
  }) as unknown as PortalExperienceActions

const list = (canApprove: boolean): PortalApprovedDestinationList => ({
  canApprove,
  destinations: [
    {
      id: 'site-1',
      normalizedUri: 'https://example.com/offer',
      hostname: 'example.com',
      sourceType: 'custom',
      approvalState: 'pending',
      lastValidatedAt: '2026-09-02T09:00:00.000Z',
    },
  ],
})

describe('linkApprovalControls', () => {
  it('gives an account admin who can edit the controls', () => {
    expect(linkApprovalControls('p-1', list(true), actions(), true)).toBeDefined()
  })

  it.each([
    ['a manager who may not approve', list(false), actions(), true],
    ['a viewer who may not edit', list(true), actions(), false],
    ['a page without the list', undefined, actions(), true],
    ['a page without the actions', list(true), undefined, true],
  ] as const)('gives %s none', (_who, sites, given, canEdit) => {
    expect(linkApprovalControls('p-1', sites, given, canEdit)).toBeUndefined()
  })

  it('approves and turns off by the site id, for this portal', async () => {
    const given = actions()
    const controls = linkApprovalControls('p-1', list(true), given, true)

    await controls?.approve('site-1')
    await controls?.turnOff('site-1')

    expect(given.approveDestination).toHaveBeenCalledWith({
      data: { portalId: 'p-1', destinationId: 'site-1' },
    })
    expect(given.disableDestination).toHaveBeenCalledWith({
      data: {
        portalId: 'p-1',
        destinationId: 'site-1',
        reason: 'Turned off by an account admin',
      },
    })
  })

  it('is busy while an approval is running', () => {
    expect(linkApprovalControls('p-1', list(true), actions(true), true)?.isBusy).toBe(
      true,
    )
  })
})

describe('siteControlsFor', () => {
  const controls = linkApprovalControls('p-1', list(true), actions(), true)

  it('finds the controls of the site a tile opens', async () => {
    const own = siteControlsFor({ url: 'https://example.com/offer' }, controls)

    expect(own?.hostname).toBe('example.com')
    await own?.approve()
    expect(controls?.sites[0]?.id).toBe('site-1')
  })

  it('has none for a tile that opens an unknown site, or for a viewer without controls', () => {
    expect(siteControlsFor({ url: 'https://old.example/' }, controls)).toBeUndefined()
    expect(
      siteControlsFor({ url: 'https://example.com/offer' }, undefined),
    ).toBeUndefined()
  })
})
