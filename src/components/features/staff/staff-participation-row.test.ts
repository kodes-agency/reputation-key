import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Action } from '#/components/hooks/use-action'
import type {
  ArchiveStaffParticipationMutationInput,
  StaffParticipationView,
} from '#/components/features/staff/types'
import { StaffParticipationRow } from './staff-participation-row'

type ArchiveInput = { data: ArchiveStaffParticipationMutationInput }
type Recorded = Readonly<{ onConfirm?: () => Promise<unknown> }>

const { recorded } = vi.hoisted(() => ({ recorded: [] as Recorded[] }))

// The archive confirmation is recorded rather than rendered: there is no DOM here
// to open it in.
vi.mock('#/components/ui/confirmation-dialog', () => ({
  ConfirmationDialog: (props: Recorded) => {
    recorded.push(props)
    return null
  },
  ConfirmationTrigger: () => null,
}))

const idle = { isPending: false, error: null, isSuccess: false, data: null }
const archiveAction: Action<ArchiveInput> = Object.assign(async () => undefined, idle)

// 22:30 UTC on 27 September is already 28 September in Sofia.
const participation: StaffParticipationView = {
  id: 'sp-1',
  organizationId: 'org-1',
  propertyId: 'prop-1',
  staffParticipantId: 'person-1',
  linkedUserId: null,
  displayName: 'Alice Adams',
  status: 'archived',
  startedAt: '2026-09-27T22:30:00.000Z',
  endedAt: new Date('2026-10-31T23:30:00.000Z'),
  archiveReason: null,
  revision: 2,
}

function renderRow(
  row: StaffParticipationView,
  action: Action<ArchiveInput> = archiveAction,
): string {
  return renderToStaticMarkup(
    createElement(
      'table',
      null,
      createElement(
        'tbody',
        null,
        createElement(StaffParticipationRow, {
          participation: row,
          canManageResponsibilities: true,
          archiveAction: action,
          onEditResponsibilities: () => undefined,
        }),
      ),
    ),
  )
}

beforeEach(() => {
  recorded.length = 0
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// The Staff page is server-rendered in the container's zone (UTC) and then
// hydrated in the viewer's. A participation date formatted with the runtime's
// own zone printed one day on the server and another in the browser, and React
// threw a hydration mismatch (#418). Rendering the row under two process zones
// stands in for the server and the browser: the markup must not differ.
describe('StaffParticipationRow dates', () => {
  it('prints the same participation period on the server and in a browser elsewhere', () => {
    vi.stubEnv('TZ', 'UTC')
    const server = renderRow(participation)
    vi.stubEnv('TZ', 'Europe/Sofia')
    const browser = renderRow(participation)

    expect(browser).toBe(server)
    expect(server).toContain('Sep 27, 2026')
    expect(server).toContain('Oct 31, 2026')
  })
})

// Archiving calls the page's Action, which rejects on a refusal (a stale
// revision). The confirmation stays open and shows the refusal itself, so the row
// hands it the rejection.
describe('StaffParticipationRow archive', () => {
  it('hands a refused archive to the confirmation, which shows it in place', async () => {
    const archives: ArchiveInput[] = []
    // A plain function, so the rejection is not pre-handled by a spy.
    const refusing: Action<ArchiveInput> = Object.assign(async (input: ArchiveInput) => {
      archives.push(input)
      throw new Error('This participation changed. Reload and try again.')
    }, idle)
    renderRow({ ...participation, status: 'active', endedAt: null }, refusing)
    const confirmation = recorded[0]
    if (!confirmation?.onConfirm) throw new Error('no archive confirmation was rendered')

    await expect(confirmation.onConfirm()).rejects.toThrow(
      'This participation changed. Reload and try again.',
    )

    expect(archives).toEqual([
      {
        data: {
          staffParticipationId: 'sp-1',
          reason: 'Archived from property Staff page',
          expectedRevision: 2,
        },
      },
    ])
  })
})
