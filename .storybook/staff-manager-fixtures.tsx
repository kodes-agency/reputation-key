import { useState, type ReactNode } from 'react'
import { StaffAccountsContext } from '#/contexts/identity/staff/ui/accounts/staff-accounts-context'
import {
  StaffAccountFunctionsContext,
  useStaffFunctions,
  type StaffAccountFunctions,
} from '#/contexts/identity/staff/ui/accounts/staff-account-functions'
import { StaffPersonSheet } from '#/contexts/identity/staff/ui/accounts/staff-person-sheet'
import { buildTestPortal } from '#/shared/testing/fixtures'
import { portalId, propertyId } from '#/shared/domain/ids'
import {
  avelaResults,
  measuresOf,
} from '#/components/features/portal/portal-overview/portal-overview-results-fixtures'
import type { StaffMember } from '#/contexts/identity/staff/ui/accounts/staff-account-view'

export const STAFF_STORY_NAMES = [
  'Ana Jones',
  'Bob Smith',
  'Li May',
  'Polly Jones',
  'Tom Okafor',
  'Zoe Park',
  'Amal Ali',
  'Ben Cole',
  'Clara Diaz',
  'Dan Evans',
  'Ella Fox',
  'Finn Green',
  'Gia Hall',
  'Hugo Ives',
  'Iva June',
]
export const STAFF_STORY_MEMBERS: readonly StaffMember[] = STAFF_STORY_NAMES.map(
  (displayName, index) => ({
    participationId: `person-${index}`,
    portalId: `portal-${index}`,
    operationId: null,
    displayName,
    email: `${displayName.toLowerCase().replaceAll(' ', '.')}@harbor.example`,
    access: index === 4 ? 'invite_expired' : index === 5 ? 'invited' : 'active',
    group: { id: index % 2 ? 'bar' : 'desk', name: index % 2 ? 'Bar' : 'Reception' },
    joinedAt: new Date('2026-09-01'),
    step: null,
    code: null,
  }),
)
export const staffStoryResults = () => {
  const base = avelaResults()
  return {
    ...base,
    portals: STAFF_STORY_MEMBERS.map((member, index) => ({
      portalId: portalId(member.portalId!),
      propertyId: propertyId('prop-1'),
      groupId: null,
      lastScanAt: index === 1 ? null : new Date(),
      ...measuresOf({
        scans: index === 1 ? 0 : 47,
        ratings: 12,
        average: 4.8,
        googleOpens: 8,
        notes: 2,
      }),
    })),
  }
}
export function StaffManagerStory({
  children,
  members = STAFF_STORY_MEMBERS.slice(0, 6),
  initialPersonId,
  canInvite = true,
}: Readonly<{
  children?: ReactNode
  members?: readonly StaffMember[]
  initialPersonId?: string
  canInvite?: boolean
}>) {
  const base = useStaffFunctions()
  const [personId, setPersonId] = useState(initialPersonId ?? null)
  const functions: StaffAccountFunctions = {
    ...base,
    getPortalResultsOverviewFn: async () => staffStoryResults(),
    listPortalGroups: async () => ({
      groups: ['desk', 'bar'].map((id) => ({
        id: id as never,
        name: id === 'desk' ? 'Reception' : 'Bar',
        portalIds: [],
        propertyId: propertyId('prop-1'),
        organizationId: 'org' as never,
        sortKey: id,
        createdBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      })),
    }),
    listPortals: async () => ({
      portals: [
        buildTestPortal({ name: 'Reception', publicationState: 'published' }),
        ...members.map((member) =>
          buildTestPortal({
            id: member.portalId!,
            name: member.displayName,
            kind: 'personal',
            publicationState: 'published',
          }),
        ),
      ],
    }),
    updatePersonalGuestPage: async () => ({ outcome: 'live' as const }),
    listPortalResponsibleManagers: async () => ({
      assignments: [
        {
          id: 'assignment',
          organizationId: 'org',
          propertyId: 'prop-1',
          portalId: 'portal-0',
          userId: 'manager',
          effectiveFrom: new Date(),
          effectiveTo: null,
          createdBy: 'manager',
          endReason: null,
        },
      ],
      eligibleManagers: [],
      revision: 1,
      responsibilityNeeded: false,
      responsibilityNeededSince: null,
    }),
    listMembers: async () => ({
      members: [
        {
          id: 'member',
          userId: 'manager',
          name: 'Maya Chen',
          email: 'maya@harbor.example',
          image: null,
          role: 'AccountAdmin',
          rawRole: 'owner',
          createdAt: new Date(),
        },
      ],
      requestingRole: 'AccountAdmin',
    }),
    getMonthlyPortalGoalLine: async () => ({
      month: '2026-11',
      monthlyGoal: null,
      ownGoal: { programId: 'goal', measure: 'qualified_scans', value: 47, target: 60 },
    }),
    resendStaffInvitation: async () => ({ sent: true }),
    renameStaffMember: async () => ({ renamed: true }),
    changeStaffInvitationEmail: async () => ({ changed: true }),
    removeStaffMember: async () => ({ removed: true }),
    setColleagueListEnabled: async ({ data }) => ({ enabled: data.enabled }),
  }
  return (
    <StaffAccountFunctionsContext value={functions}>
      <StaffAccountsContext
        value={{
          propertyId: 'prop-1',
          ready: true,
          members,
          colleagueListEnabled: false,
          canInvite,
          canRemove: true,
          canSettings: canInvite,
          staffScanTargetsEnabled: true,
          openAdd: () => undefined,
          openPerson: setPersonId,
          refresh: async () => undefined,
        }}
      >
        {children}
        {personId ? (
          <StaffPersonSheet
            participationId={personId}
            onClose={() => setPersonId(null)}
          />
        ) : null}
      </StaffAccountsContext>
    </StaffAccountFunctionsContext>
  )
}
export const STAFF_VIEWPORTS = {
  narrow: { name: '320', styles: { width: '320px', height: '900px' } },
  phone: { name: '375', styles: { width: '375px', height: '900px' } },
  tablet: { name: '768', styles: { width: '768px', height: '900px' } },
  desktop: { name: '1440', styles: { width: '1440px', height: '900px' } },
}
