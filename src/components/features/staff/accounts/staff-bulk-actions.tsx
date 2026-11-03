import { moveStaffPerson } from './staff-group-actions'
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { FormSelectField } from '#/components/forms/form-select-field'
import {
  useActionMutation,
  actionErrorMessage,
} from '#/components/hooks/use-action-mutation'
import { useStaffFunctions } from './staff-account-functions'
import { useStaffAccounts } from './staff-accounts-context'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import type { StaffMember } from './staff-account-view'

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

export function StaffBulkActions({
  selected,
  groups,
  onClear,
}: Readonly<{
  selected: readonly StaffMember[]
  groups: readonly Readonly<{ id: string; name: string }>[]
  onClear: () => void
}>) {
  const functions = useStaffFunctions()
  const accounts = useStaffAccounts()
  const { can } = usePermissions()
  const { has } = useCapabilities()
  const [group, setGroup] = useState('')
  const [messages, setMessages] = useState<readonly string[]>([])
  const action = useActionMutation(async (kind: 'resend' | 'move') => {
    const eligible =
      kind === 'resend'
        ? selected.filter(
            (member) => member.access === 'invited' || member.access === 'invite_expired',
          )
        : selected
    const failures = await runStaffBatch(eligible, async (member) => {
      if (kind === 'resend')
        return functions.resendStaffInvitation({
          data: { participationId: member.participationId },
        })
      return moveStaffPerson(functions, member, group)
    })
    const skipped = selected.length - eligible.length
    setMessages([
      ...failures,
      ...(skipped
        ? [
            `${skipped} already joined or have unfinished setup; their invitations were skipped.`,
          ]
        : []),
      ...(failures.length
        ? []
        : [
            kind === 'resend'
              ? `${eligible.length} invitations sent.`
              : `${eligible.length} moved.`,
          ]),
    ])
    await accounts?.refresh()
  })
  return (
    <div className="space-y-3 rounded-lg border p-3" aria-label="Selected staff">
      <div className="flex flex-wrap items-center gap-2">
        <span>{selected.length} selected</span>
        {accounts?.canInvite ? (
          <Button
            variant="outline"
            pending={action.isPending}
            pendingLabel="Working…"
            onClick={() => void action('resend').catch(() => undefined)}
          >
            Resend invitations
          </Button>
        ) : null}
        {can('portal.update') && has('portal.write') ? (
          <>
            <FormSelectField
              id="staff-bulk-group"
              label="Move to group"
              placeholder="Choose a group…"
              value={group}
              onValueChange={setGroup}
              disabled={action.isPending}
              options={[
                { value: 'none', label: 'No group' },
                ...groups.map((item) => ({ value: item.id, label: item.name })),
              ]}
            />
            <Button
              variant="outline"
              disabled={!group}
              pending={action.isPending}
              pendingLabel="Moving…"
              onClick={() => void action('move').catch(() => undefined)}
            >
              Move to group
            </Button>
          </>
        ) : null}
        <Button variant="ghost" disabled={action.isPending} onClick={onClear}>
          Clear selection
        </Button>
      </div>
      <div role="status">
        {messages.map((message) => (
          <p key={message} className="text-sm">
            {message}
          </p>
        ))}
      </div>
    </div>
  )
}
