import { StaffPersonSheet } from './staff-person-sheet'
import { useStaffFunctions } from './staff-account-functions'
import { hasFailed, isRetrying } from '#/components/hooks/is-retrying'
import { DataTableBody, DataTableRow, DataTableCell } from '#/components/ui/data-table'
import { useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { staffAccountsQuery } from './staff-accounts-query'
import { portalKeys, staffKeys } from '#/shared/queries/query-keys'
import { RegionError } from '#/components/ui/region-error'
import { StaffAccountsContext, useStaffAccounts } from './staff-accounts-context'
import { StaffAddDialog } from './staff-add-dialog'

/** One roster read per Property, shared by every row. No staff RPC when off. */
export function StaffAccountsProvider({
  propertyId,
  children,
  inTable = false,
}: Readonly<{ propertyId: string; children: ReactNode; inTable?: boolean }>) {
  const functions = useStaffFunctions()
  const parent = useStaffAccounts()
  const { all } = useCapabilities()
  const { can } = usePermissions()
  const enabled = !parent && all.includes('staff.accounts')
  const client = useQueryClient()
  const personOpener = useRef<HTMLElement | null>(null)
  const [personId, setPersonId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [groupId, setGroupId] = useState<string | undefined>(undefined)
  const roster = useQuery({
    ...staffAccountsQuery(propertyId, functions.listStaffMembers),
    enabled: enabled && can('staff.read'),
  })
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: staffKeys.all }),
      client.invalidateQueries({ queryKey: portalKeys.all }),
    ])
  }
  if (!enabled) return children
  return (
    <StaffAccountsContext
      value={{
        propertyId,
        openPerson: (id) => {
          personOpener.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null
          setPersonId(id)
        },
        staffScanTargetsEnabled: roster.data?.staffScanTargetsEnabled ?? false,
        ready: roster.isSuccess,
        members: roster.data?.members ?? [],
        colleagueListEnabled: roster.data?.colleagueListEnabled ?? false,
        canInvite: can('staff.invite'),
        canRemove: can('staff.remove'),
        canSettings: can('staff.settings'),
        refresh,
        openAdd: (id) => {
          setGroupId(id)
          setAdding(true)
        },
      }}
    >
      {hasFailed(roster) ? (
        <StaffRosterError
          inTable={inTable}
          retrying={isRetrying(roster)}
          onRetry={() => void roster.refetch()}
        />
      ) : null}
      {children}
      {personId ? (
        <StaffPersonSheet
          key={personId}
          participationId={personId}
          onRestoreFocus={() => {
            const target = personOpener.current?.isConnected
              ? personOpener.current
              : document.querySelector<HTMLElement>('main h1')
            if (target) {
              if (!target.hasAttribute('tabindex') && target.tagName === 'H1')
                target.tabIndex = -1
              target.focus()
            }
          }}
          onClose={() => setPersonId(null)}
        />
      ) : null}
      {adding ? (
        <StaffAddDialog
          propertyId={propertyId}
          groupId={groupId}
          onClose={() => {
            setAdding(false)
            void refresh()
          }}
        />
      ) : null}
    </StaffAccountsContext>
  )
}

function StaffRosterError({
  inTable,
  retrying,
  onRetry,
}: Readonly<{ inTable: boolean; retrying: boolean; onRetry: () => void }>) {
  const error = (
    <RegionError
      message="Staff could not be loaded."
      retrying={retrying}
      onRetry={onRetry}
    />
  )
  return inTable ? (
    <DataTableBody>
      <DataTableRow>
        <DataTableCell colSpan={9}>{error}</DataTableCell>
      </DataTableRow>
    </DataTableBody>
  ) : (
    error
  )
}
