import type {
  checkStaffBatch,
  addStaffMember,
} from '#/contexts/identity/server/staff-accounts'
import { actionErrorMessage } from '#/components/hooks/use-action-mutation'
import { parseStaffPaste } from './staff-paste'

export const STAFF_BATCH_LIMIT = 20
export type StaffDraftRow = Readonly<{
  operationId: string
  displayName: string
  email: string
  state: 'editing' | 'sending' | 'added' | 'invited' | 'failed'
  problem: string | null
}>
export const newStaffRow = (operationId: string): StaffDraftRow => ({
  operationId,
  displayName: '',
  email: '',
  state: 'editing',
  problem: null,
})

export function pasteStaffRows(
  rows: readonly StaffDraftRow[],
  at: number,
  text: string,
  id: () => string,
) {
  const parsed = parseStaffPaste(text)
  const available = STAFF_BATCH_LIMIT - at
  const next = [...rows]
  parsed.slice(0, available).forEach((person, offset) => {
    const index = at + offset
    next[index] = {
      ...(next[index] ?? newStaffRow(id())),
      ...(person.email ? { email: person.email } : {}),
      ...(person.displayName ? { displayName: person.displayName } : {}),
      problem: null,
    }
  })
  return { rows: next, omitted: Math.max(0, parsed.length - available) }
}

const PROBLEMS: Readonly<Record<string, string>> = {
  invalid_email: 'Enter a valid email address.',
  name_required: 'Enter a name of up to 100 characters.',
  duplicate_in_batch: 'This email appears more than once.',
  already_staff_here: 'This person is already staff here.',
  already_invited:
    "This address already has an open invitation. Add them here once they've accepted.",
  cannot_add: "This email can't be added.",
  other_organization: 'This email belongs to another organisation.',
  source_archived: 'This portal is archived. Pick another portal.',
  brand_profile_missing:
    'This property has no public name yet. Set it in Property settings, or pick a portal to copy.',
  invalid_name:
    "This property's public name is over 100 characters. Shorten it, or pick a portal to copy.",
  address_keyring_missing:
    'Codes cannot be recovered yet. Ask your account admin to set up code recovery.',
  rate_limited: 'Please wait before sending more invitations.',
  personal_portal_goal_locked: 'End the goal first.',
}
export function staffProblem(
  code: string | null,
  sourceName = 'This portal',
): string | null {
  if (!code || code === 'ok') return null
  if (code === 'source_has_unpublished_changes')
    return `${sourceName} has unpublished changes. Publish them or pick another portal.`
  return PROBLEMS[code] ?? "Setup didn't finish. Try again."
}

type Check = Awaited<ReturnType<typeof checkStaffBatch>>
export function checkedStaffRows(rows: readonly StaffDraftRow[], check: Check) {
  return rows.map((row, index) => ({
    ...row,
    problem: staffProblem(check.rows[index]?.code ?? 'preflight_failed'),
  }))
}

/** Sends in order, retaining operation ids after any failure. A row never aborts the batch. */
export async function sendStaffRows(
  rows: readonly StaffDraftRow[],
  send: (row: StaffDraftRow) => ReturnType<typeof addStaffMember>,
  update: (row: StaffDraftRow) => void,
) {
  for (const row of rows) {
    update({ ...row, state: 'sending', problem: null })
    try {
      const result = await send(row)
      update({
        ...row,
        state:
          result.status === 'done'
            ? result.access === 'invited'
              ? 'invited'
              : 'added'
            : 'failed',
        problem:
          result.status === 'done'
            ? null
            : (staffProblem(result.code) ?? "Setup didn't finish. Try again."),
      })
    } catch (error) {
      update({ ...row, state: 'failed', problem: actionErrorMessage(error) })
    }
  }
}

export function staffBatchProblem(check: Check, sourceName?: string): string | null {
  const source = staffProblem(check.code, sourceName)
  if (source) return source
  return check.remainingInvitations < check.invitationsRequired
    ? `Only ${check.remainingInvitations} invitations remain. This batch needs ${check.invitationsRequired}. Remove some people before adding.`
    : null
}
