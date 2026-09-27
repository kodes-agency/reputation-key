// The People page is server-rendered in the container's zone (UTC) and then
// hydrated in the viewer's. A participation date formatted with the runtime's
// own zone printed one day on the server and another in the browser, and React
// threw a hydration mismatch (#418). Rendering the row under two process zones
// stands in for the server and the browser: the markup must not differ.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Action } from '#/components/hooks/use-action'
import type {
  ArchiveStaffParticipationMutationInput,
  StaffParticipationView,
} from '#/components/features/staff/types'
import { StaffParticipationRow } from './staff-participation-row'

const archiveAction: Action<{ data: ArchiveStaffParticipationMutationInput }> =
  Object.assign(async () => undefined, {
    isPending: false,
    error: null,
    isSuccess: false,
    data: null,
  })

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

function renderRowIn(timeZone: string): string {
  vi.stubEnv('TZ', timeZone)
  return renderToStaticMarkup(
    createElement(
      'table',
      null,
      createElement(
        'tbody',
        null,
        createElement(StaffParticipationRow, {
          participation,
          canManageResponsibilities: true,
          archiveAction,
          onEditResponsibilities: () => undefined,
        }),
      ),
    ),
  )
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('StaffParticipationRow dates', () => {
  it('prints the same participation period on the server and in a browser elsewhere', () => {
    const server = renderRowIn('UTC')
    const browser = renderRowIn('Europe/Sofia')

    expect(browser).toBe(server)
    expect(server).toContain('Sep 27, 2026')
    expect(server).toContain('Oct 31, 2026')
  })
})
