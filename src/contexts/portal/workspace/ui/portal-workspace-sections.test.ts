// The Share, History and Results sections own what they read. A section that is
// still reading says so itself, one that cannot read says so and offers to try
// again, and neither holds up the rest of the workspace. Once its reads answer
// it forwards what the route loaded to its screen; the screens are correct on
// their own (they have stories), so a prop forgotten here fails no other test:
// Share went without its notice, its time zone, its country (the print kit's
// paper) and the managers' names. The screens are recorded here rather than
// rendered.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PortalPublicationState } from '#/components/features/portal/shared/types'
import type { PortalPublicationHistory } from '#/contexts/portal/application/portal-management-contracts'
import type {
  PortalDetailPortal,
  PortalResponsibleManagerState,
} from './portal-detail-types'
import { PortalHistorySection } from './portal-history-section'
import type { PortalHistoryReads } from './portal-history-tab'
import type { SectionRead } from './portal-read-state'
import { PortalShareSection, type PortalShareCommands } from './portal-share-section'

type Recorded = Readonly<Record<string, unknown>>

const { shares, histories, permissions } = vi.hoisted(() => ({
  shares: [] as Recorded[],
  histories: [] as Recorded[],
  permissions: { canUpdate: true, hasWrite: true },
}))

vi.mock('#/components/features/portal/portal-share/portal-share', () => ({
  PortalShare: (props: Recorded) => {
    shares.push(props)
    return null
  },
}))
vi.mock('./portal-history-tab', () => ({
  PortalHistoryTab: (props: Recorded) => {
    histories.push(props)
    return null
  },
}))
vi.mock('#/shared/hooks/usePermissions', () => ({
  usePermissions: () => ({ can: () => permissions.canUpdate }),
}))
vi.mock('#/shared/hooks/useCapabilities', () => ({
  useCapabilities: () => ({ has: () => permissions.hasWrite }),
}))

const TOKEN = {
  hasActiveToken: true,
  qualifiedScanReady: true,
  version: 1,
  issuedAt: '2026-03-12T09:30:00.000Z',
  graceExpiresAt: null,
  addressRecoverable: true,
  madeBy: null,
}

const MEMBERS = [
  { userId: 'u1', name: 'Ana Petrova', email: 'ana@example.com', role: 'AccountAdmin' },
  { userId: 'u2', name: 'Boris Ivanov', email: 'boris@example.com', role: null },
]

const MANAGERS: PortalResponsibleManagerState = {
  assignments: [{ userId: 'u1' }],
  eligibleManagers: [
    { userId: 'u1', role: 'AccountAdmin' },
    { userId: 'u2', role: 'PropertyManager' },
  ],
  revision: 1,
  responsibilityNeeded: false,
  responsibilityNeededSince: null,
}

const HISTORY: PortalPublicationHistory = {
  current: null,
  priorActivations: [],
  hasPendingChanges: true,
  nextCursor: null,
}

/** A server function the sections only pass along, never call. */
const serverFn = <T>() => vi.fn() as unknown as T

const HISTORY_READS: PortalHistoryReads = {
  getHistory: serverFn(),
  getVersions: serverFn(),
  getVersion: serverFn(),
  getVersionPreview: serverFn(),
}

type ReadState = 'ready' | 'loading' | 'failed'

/** A read as a section sees it, in the state a test asks for. */
function read<T>(data: T, state: ReadState = 'ready'): SectionRead<T> {
  return {
    data: state === 'ready' ? data : undefined,
    isError: state === 'failed',
    isFetching: false,
    errorUpdateCount: state === 'failed' ? 1 : 0,
    refetch: vi.fn(),
  }
}

const action = () =>
  Object.assign(vi.fn(), {
    isPending: false,
    error: null,
    isSuccess: false,
    data: null,
  })

const COMMANDS: PortalShareCommands = {
  issueToken: action(),
  rotateToken: action(),
  revokeToken: action(),
  revealAddress: action(),
}

const ISSUANCE = {
  issuedLink: null,
  linksRevoked: false,
  onLinkIssued: vi.fn(),
  onAddressRevealed: vi.fn(),
  onLinksRevoked: vi.fn(),
}

function portalIn(publicationState: PortalPublicationState): PortalDetailPortal {
  return {
    id: 'portal-1',
    name: 'Pool',
    propertyId: 'property-1',
    publicationState,
    skipPrivateRating: false,
  } as PortalDetailPortal
}

function renderShare(
  options: Readonly<{
    managers?: ReadState
    members?: ReadState
    countryCode?: string | null
    managersData?: PortalResponsibleManagerState
    publicationState?: PortalPublicationState
  }> = {},
): string {
  return renderToStaticMarkup(
    createElement(PortalShareSection, {
      portal: portalIn(options.publicationState ?? 'draft'),
      tokenStatus: TOKEN,
      property: {
        timeZone: 'Europe/Sofia',
        countryCode: options.countryCode === undefined ? 'BG' : options.countryCode,
      },
      reads: {
        managers: read(options.managersData ?? MANAGERS, options.managers),
        members: read({ members: MEMBERS }, options.members),
      },
      commands: COMMANDS,
      issuance: ISSUANCE,
    }),
  )
}

function renderHistory(
  state: ReadState,
  publicationState: PortalPublicationState = 'published',
): string {
  return renderToStaticMarkup(
    createElement(PortalHistorySection, {
      portal: portalIn(publicationState),
      timeZone: 'Europe/Sofia',
      history: read(HISTORY, state),
      reads: HISTORY_READS,
      makeLive: action(),
    }),
  )
}

beforeEach(() => {
  shares.length = 0
  histories.length = 0
  permissions.canUpdate = true
  permissions.hasWrite = true
})

describe('the Share section', () => {
  it('says it is loading while the managers are read, and draws no screen', () => {
    const markup = renderShare({ managers: 'loading' })

    expect(markup).toContain('Loading sharing details')
    expect(shares).toHaveLength(0)
  })

  it('says it is loading while the members are read', () => {
    expect(renderShare({ members: 'loading' })).toContain('Loading sharing details')
    expect(shares).toHaveLength(0)
  })

  it('says the details could not be loaded when a read fails, and offers to try again', () => {
    const markup = renderShare({ members: 'failed' })

    expect(markup).toContain('The sharing details couldn’t be loaded.')
    expect(markup).toContain('Try again')
    expect(shares).toHaveLength(0)
  })

  it('is told where the portal stands, so a draft gets its notice and its link', () => {
    renderShare()

    expect(shares).toHaveLength(1)
    expect(shares[0]).toMatchObject({
      portalId: 'portal-1',
      propertyId: 'property-1',
      publicationState: 'draft',
    })
  })

  it('is given the property’s zone, so the old code’s cutoff is in its time', () => {
    renderShare()

    expect(shares[0]).toMatchObject({ timeZone: 'Europe/Sofia' })
  })

  it('is given the property’s country, so the print kit starts on the paper that country uses', () => {
    renderShare()
    expect(shares[0]).toMatchObject({ countryCode: 'BG' })

    shares.length = 0
    renderShare({ countryCode: null })
    expect(shares[0]).toMatchObject({ countryCode: null })
  })

  it('names the responsible managers for someone who can only look', () => {
    renderShare()

    expect(shares[0]?.managerNames).toEqual(['Ana Petrova'])
  })

  it('names the managers who could be made responsible when none is yet', () => {
    renderShare({ managersData: { ...MANAGERS, assignments: [] } })

    expect(shares[0]?.managerNames).toEqual(['Ana Petrova', 'Boris Ivanov'])
  })

  it('offers the print kit only when it is given one', () => {
    renderShare()

    expect(shares[0]?.printKit).toBeUndefined()
  })
})

describe('the History section', () => {
  it('says it is loading while the publication history is read', () => {
    expect(renderHistory('loading')).toContain('Loading publication history')
    expect(histories).toHaveLength(0)
  })

  it('says the history could not be loaded, and offers to try again', () => {
    const markup = renderHistory('failed')

    expect(markup).toContain('The publication history couldn’t be loaded.')
    expect(markup).toContain('Try again')
    expect(histories).toHaveLength(0)
  })

  it('tells the tab how many changes the draft holds and whether the page is live', () => {
    renderHistory('ready')

    expect(histories[0]).toMatchObject({
      portalId: 'portal-1',
      timeZone: 'Europe/Sofia',
      pendingChangeCount: 1,
      pageIsLive: true,
      mayMakeLive: true,
    })
  })

  it('does not let a viewer without portal.update switch the live version', () => {
    permissions.canUpdate = false
    renderHistory('ready')

    expect(histories[0]).toMatchObject({ mayMakeLive: false })
  })

  it('does not let anyone switch the live version while portal writes are off', () => {
    permissions.hasWrite = false
    renderHistory('ready')

    expect(histories[0]).toMatchObject({ mayMakeLive: false })
  })

  it('knows a page that is not published is not live', () => {
    renderHistory('ready', 'draft')

    expect(histories[0]).toMatchObject({ pageIsLive: false })
  })
})
