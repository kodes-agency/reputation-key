import { overviewSectionName } from './portal-staff-sections'
import { highRatingFromFewGuests } from '#/components/features/staff/accounts/staff-rating-hint'
// One group's part of a Portals table: its head row (unless the list is flat) and
// the Portals the group holds, unless the reader folded it. Shared by the page of
// one Property and the page of the whole Organization, so a group reads the same
// in both.
import { RowActionsItem, RowActionsMenu } from '#/components/ui/row-actions-menu'
import { useStaffAccounts } from '#/components/features/staff/accounts/staff-accounts-context'
import type { ReactNode } from 'react'
import { groupSlot, type PortalOverviewResultsState } from './portal-overview-results'
import { portalMeasureSlot } from './portal-overview-uncounted'
import type { PortalArchiveMutations } from './portal-archive-dialog'
import { PortalOverviewGroupHead } from './portal-overview-group-head'
import { PortalOverviewTableRow } from './portal-overview-table-row'
import type { PortalOverviewItem, PortalOverviewSection } from './portal-overview-view'

type Props = PortalArchiveMutations &
  Readonly<{
    section: PortalOverviewSection
    /** The Property the section's Portals are in: a group never spans Properties. */
    propertyId: string
    results: PortalOverviewResultsState
    expanded: boolean
    onToggle: () => void
    /** The group sits under a Property's head, so it is indented and lighter than one. */
    nested?: boolean
    /** A group's actions menu, drawn in its head. Left out, groups have none. */
    groupActions?: (group: NonNullable<PortalOverviewSection['group']>) => ReactNode
    /** Extra entries in each Portal's "more actions" menu (the group page's "Remove"). */
    rowMenuExtra?: (item: PortalOverviewItem) => ReactNode
    /** Say which group each Portal is in. Default: only in a flat list, which has no heads. */
    showGroup?: boolean
  }>

export function PortalOverviewSectionRows({
  section,
  propertyId,
  results,
  expanded,
  onToggle,
  nested = false,
  groupActions,
  rowMenuExtra,
  showGroup,
  archiveMutation,
  restoreMutation,
  disableMutation,
}: Props) {
  const accounts = useStaffAccounts()
  const hints =
    results.status === 'ready' && results.index.staffFigures && accounts
      ? highRatingFromFewGuests(
          accounts.members.map((member) =>
            results.index.staffFigures!(member.portalId ?? member.participationId),
          ),
        )
      : new Set<string>()
  const headed = section.kind !== 'flat'
  const head = groupSlot(results, (index) =>
    section.group
      ? index.group(section.group.id)
      : section.kind === 'staff'
        ? ((section.key === 'staff'
            ? index.staff?.(propertyId)
            : index.otherStaff?.(propertyId)) ?? null)
        : index.ungrouped(propertyId),
  )
  return (
    <>
      {headed ? (
        <PortalOverviewGroupHead
          propertyId={propertyId}
          actions={<SectionActions section={section} groupActions={groupActions} />}
          section={section}
          figures={head.slot}
          readCount={head.memberCount}
          expanded={expanded}
          onToggle={onToggle}
          nested={nested}
        />
      ) : null}
      {expanded
        ? section.items.map((item) => (
            <PortalOverviewTableRow
              key={item.row.portalId}
              item={item}
              staffHint={hints.has(item.row.portalId)}
              figures={portalMeasureSlot(results, item.row)}
              propertyId={propertyId}
              showGroup={showGroup ?? !headed}
              menuExtra={rowMenuExtra?.(item)}
              archiveMutation={archiveMutation}
              restoreMutation={restoreMutation}
              disableMutation={disableMutation}
            />
          ))
        : null}
    </>
  )
}

function SectionActions({
  section,
  groupActions,
}: Pick<Props, 'section' | 'groupActions'>) {
  const accounts = useStaffAccounts()
  if (section.group && groupActions) return groupActions(section.group)
  if (!accounts?.canInvite || (!section.group && section.kind !== 'staff')) return null
  return (
    <RowActionsMenu name={overviewSectionName(section)}>
      <RowActionsItem opensDialog onSelect={() => accounts.openAdd(section.group?.id)}>
        Add people
      </RowActionsItem>
    </RowActionsMenu>
  )
}
