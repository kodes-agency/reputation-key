import { moveStaffPerson } from './staff-group-actions'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import {
  ConfirmationDialog,
  ConfirmationTrigger,
} from '#/components/ui/confirmation-dialog'
import { portalKeys } from '#/shared/queries/query-keys'
import { FormSelectField } from '#/components/forms/form-select-field'
import {
  useActionMutation,
  actionErrorMessage,
} from '#/components/hooks/use-action-mutation'
import type { Action } from '#/components/hooks/use-action'
import { useStaffFunctions } from './staff-account-functions'
import { useStaffAccounts } from './staff-accounts-context'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import type { StaffMember } from './staff-account-view'

const invited = (member: StaffMember) =>
  member.access === 'invited' || member.access === 'invite_expired'

/** A page to update: setup got as far as making one, and didn't stop there. */
const hasGuestPage = (member: StaffMember) =>
  Boolean(member.portalId) && member.access !== 'failed'

/** What really happened to each page: overwriting can't be undone, so nothing is left out. */
export function guestPageSummary(
  result: Readonly<{
    live: number
    paused: number
    notLive: readonly string[]
    failures: readonly string[]
    skipped: number
  }>,
): readonly string[] {
  const { live, paused, notLive, failures, skipped } = result
  return [
    ...failures,
    ...notLive,
    ...(live ? [`${live} guest ${live === 1 ? 'page' : 'pages'} updated.`] : []),
    ...(paused ? [`${paused} paused; their new page shows when they’re back.`] : []),
    ...(skipped
      ? [`${skipped} have unfinished setup; their guest pages were skipped.`]
      : []),
  ]
}

/** Independent single-person commands, like Add: one refusal never stops the next row. */
export async function runStaffBatch(
  members: readonly StaffMember[],
  run: (member: StaffMember) => Promise<unknown>,
) {
  const failures: string[] = []
  for (const member of members) {
    try {
      await run(member)
    } catch (error) {
      failures.push(`${member.displayName}: ${actionErrorMessage(error)}`)
    }
  }
  return failures
}

type BulkKind = 'resend' | 'move' | 'page'
type BulkProps = Readonly<{
  selected: readonly StaffMember[]
  /** Which action is running, if any: one at a time. */
  active: BulkKind | null
  run: Action<BulkRun>
}>
type BulkRun = Readonly<{
  kind: BulkKind
  /** Does the work and says what happened, person by person. */
  work: () => Promise<readonly string[]>
}>

function BulkResend({ selected, active, run }: BulkProps) {
  const functions = useStaffFunctions()
  const eligible = selected.filter(invited)
  const work = async () => {
    const failures = await runStaffBatch(eligible, (member) =>
      functions.resendStaffInvitation({
        data: { participationId: member.participationId },
      }),
    )
    const skipped = selected.length - eligible.length
    const sent = eligible.length - failures.length
    return [
      ...failures,
      ...(skipped
        ? [
            `${skipped} already joined or have unfinished setup; their invitations were skipped.`,
          ]
        : []),
      ...(sent ? [`${sent} invitations sent.`] : []),
    ]
  }
  return (
    <Button
      variant="outline"
      disabled={active !== null && active !== 'resend'}
      pending={active === 'resend'}
      pendingLabel="Sending…"
      onClick={() => void run({ kind: 'resend', work }).catch(() => undefined)}
    >
      Resend invitations
    </Button>
  )
}

function BulkMove({
  selected,
  active,
  run,
  groups,
}: BulkProps & Readonly<{ groups: readonly Readonly<{ id: string; name: string }>[] }>) {
  const functions = useStaffFunctions()
  const [group, setGroup] = useState('')
  const work = async () => {
    const failures = await runStaffBatch(selected, (member) =>
      moveStaffPerson(functions, member, group),
    )
    const moved = selected.length - failures.length
    return [...failures, ...(moved ? [`${moved} moved.`] : [])]
  }
  return (
    <div className="flex min-w-0 flex-1 basis-80 items-end gap-2">
      <div className="min-w-0 flex-1">
        <FormSelectField
          id="staff-bulk-group"
          label="Move to group"
          placeholder="Choose a group…"
          value={group}
          onValueChange={setGroup}
          disabled={active !== null}
          options={[
            { value: 'none', label: 'No group' },
            ...groups.map((item) => ({ value: item.id, label: item.name })),
          ]}
        />
      </div>
      <Button
        variant="outline"
        disabled={!group || (active !== null && active !== 'move')}
        pending={active === 'move'}
        pendingLabel="Moving…"
        onClick={() => void run({ kind: 'move', work }).catch(() => undefined)}
      >
        Move
      </Button>
    </div>
  )
}

function BulkGuestPages({ selected, active, run }: BulkProps) {
  const functions = useStaffFunctions()
  const accounts = useStaffAccounts()
  const [source, setSource] = useState('')
  const portals = useQuery({
    queryKey: portalKeys.list(accounts?.propertyId ?? ''),
    queryFn: () =>
      functions.listPortals({ data: { propertyId: accounts?.propertyId ?? '' } }),
    enabled: Boolean(accounts?.propertyId),
  })
  const sources = (portals.data?.portals ?? [])
    .filter((p) => p.publicationState === 'published' && p.kind !== 'personal')
    .map((p) => ({ value: p.id, label: p.name }))
  const sourceName = sources.find((option) => option.value === source)?.label
  const pages = selected.filter(hasGuestPage)
  const pageWords = pages.length === 1 ? 'guest page' : `${pages.length} guest pages`
  const work = async () => {
    const outcomes = { live: 0, paused: 0, notLive: [] as string[] }
    const failures = await runStaffBatch(pages, async (member) => {
      const result = await functions.updatePersonalGuestPage({
        data: { portalId: member.portalId!, sourcePortalId: source },
      })
      if (result.outcome === 'live') outcomes.live += 1
      if (result.outcome === 'saved') outcomes.paused += 1
      if (result.outcome === 'not_live')
        outcomes.notLive.push(
          `${member.displayName}: saved, but not live yet. ${result.message}`,
        )
    })
    // A second Update would make a new version of every page for nothing.
    setSource('')
    return guestPageSummary({
      ...outcomes,
      failures,
      skipped: selected.length - pages.length,
    })
  }
  return (
    <div className="flex min-w-0 flex-1 basis-80 items-end gap-2">
      <div className="min-w-0 flex-1">
        <FormSelectField
          id="staff-bulk-guest-page"
          label="Guests see the same page as"
          placeholder="Choose a portal…"
          value={source}
          onValueChange={setSource}
          disabled={active !== null}
          options={sources}
        />
      </div>
      <ConfirmationDialog
        trigger={
          <ConfirmationTrigger
            tone="destructive"
            disabled={!sourceName || pages.length === 0 || active !== null}
          >
            Update
          </ConfirmationTrigger>
        }
        tone="destructive"
        title={`Update ${pageWords}?`}
        description={`${sourceName ?? 'This portal'}'s wording, links and look replace theirs and go live now. Anything customised on ${pages.length === 1 ? 'that page' : 'those pages'} is overwritten. Codes, results and who hears from guests stay the same.`}
        cancelLabel="Cancel"
        confirmLabel="Update"
        pendingLabel="Updating…"
        onConfirm={() => run({ kind: 'page', work })}
      />
    </div>
  )
}

export function StaffBulkActions({
  selected,
  groups,
  onClear,
}: Readonly<{
  selected: readonly StaffMember[]
  groups: readonly Readonly<{ id: string; name: string }>[]
  onClear: () => void
}>) {
  const accounts = useStaffAccounts()
  const { can } = usePermissions()
  const { has } = useCapabilities()
  const [active, setActive] = useState<BulkKind | null>(null)
  const [messages, setMessages] = useState<readonly string[]>([])
  const run = useActionMutation(async ({ kind, work }: BulkRun) => {
    setActive(kind)
    try {
      setMessages(await work())
      await accounts?.refresh()
    } finally {
      setActive(null)
    }
  })
  const actions = { selected, active, run }
  return (
    <div className="space-y-3 rounded-lg border p-3" aria-label="Selected staff">
      <div className="flex flex-wrap items-center gap-2">
        <span>{selected.length} selected</span>
        {accounts?.canInvite ? <BulkResend {...actions} /> : null}
        <div className="ml-auto">
          <Button variant="ghost" disabled={active !== null} onClick={onClear}>
            Clear selection
          </Button>
        </div>
      </div>
      {can('portal.update') && has('portal.write') ? (
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <BulkMove {...actions} groups={groups} />
          <BulkGuestPages {...actions} />
        </div>
      ) : null}
      <div role="status">
        {messages.map((message, index) => (
          <p key={`${index}:${message}`} className="text-sm">
            {message}
          </p>
        ))}
      </div>
    </div>
  )
}
