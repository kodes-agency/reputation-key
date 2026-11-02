import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { seededArgs } from './people-page-stories-data'
import { StaffTab } from './staff-tab'
const list = vi.hoisted(() => vi.fn())
vi.mock('#/components/features/staff', () => ({
  StaffParticipationList: (props: unknown) => {
    list(props)
    return null
  },
  StaffParticipationForm: () => null,
}))
vi.mock('#/components/features/staff/portal-responsibilities-modal', () => ({
  PortalResponsibilitiesModal: () => null,
}))
it('hides a personal participation before the account roster has arrived', () => {
  const props = {
    ...seededArgs,
    participations: [{ ...seededArgs.participations[0]!, personalPortalId: 'personal' }],
    portalOptions: [],
    accountsEnabled: true,
    personalParticipationIds: [],
    createMutation: seededArgs.createParticipationMutation,
    archiveMutation: seededArgs.archiveParticipationMutation,
    createOpen: false,
    onCreateOpenChange: vi.fn(),
  }
  const html = renderToStaticMarkup(createElement(StaffTab, props))
  expect(list).not.toHaveBeenCalled()
  expect(html).not.toContain('Alice Adams')
})
