import { describe, it, expect, vi } from 'vitest'
import {
  checkedStaffRows,
  newStaffRow,
  sendStaffRows,
  staffProblem,
  staffBatchProblem,
  type StaffDraftRow,
} from './staff-batch'
const result = (
  operationId: string,
  status: 'failed' | 'done',
  access?: 'active' | 'invited',
) => ({
  operationId,
  participationId: 'person',
  portalId: 'portal',
  status,
  step: 'access' as const,
  code: status === 'failed' ? 'step_failed' : null,
  access,
})
describe('staff batch', () => {
  it('puts preflight faults beside the corresponding row', () => {
    const rows = [newStaffRow('a'), newStaffRow('b')]
    expect(
      checkedStaffRows(rows, {
        rows: [{ code: 'invalid_email' }, { code: 'ok' }],
        code: null,
        omittedLinks: [],
        remainingInvitations: 10,
        invitationsRequired: 2,
      }).map((row) => row.problem),
    ).toEqual(['Enter a valid email address.', null])
    expect(staffProblem('source_has_unpublished_changes', 'Reception')).toBe(
      'Reception has unpublished changes. Publish them or pick another portal.',
    )
    expect(staffProblem('address_keyring_missing')).toContain('code recovery')
  })
  it('sends in order, continues after failure, and retries the original operation', async () => {
    const rows = ['a', 'b', 'c'].map(newStaffRow)
    const states: StaffDraftRow[] = []
    const send = vi.fn(async (row: StaffDraftRow) =>
      result(
        row.operationId,
        row.operationId === 'b' ? 'failed' : 'done',
        row.operationId === 'c' ? 'invited' : 'active',
      ),
    )
    await sendStaffRows(rows, send, (row) => states.push(row))
    expect(send.mock.calls.map(([row]) => row.operationId)).toEqual(['a', 'b', 'c'])
    expect(states.map((row) => row.state)).toEqual([
      'sending',
      'added',
      'sending',
      'failed',
      'sending',
      'invited',
    ])
    const failed = states.find((row) => row.state === 'failed')!
    await sendStaffRows([failed], send, (row) => states.push(row))
    expect(send.mock.calls.at(-1)?.[0].operationId).toBe('b')
  })
  it('continues when a server call rejects', async () => {
    const states: StaffDraftRow[] = []
    await sendStaffRows(
      ['a', 'b'].map(newStaffRow),
      async (row) => {
        if (row.operationId === 'a') throw new Error('offline')
        return result('b', 'done')
      },
      (row) => states.push(row),
    )
    expect(states.at(-1)?.state).toBe('added')
    expect(states[1]?.problem).toBe('Something went wrong. Try again.')
  })
})

it('blocks a batch before sending when invitations are short, but permits existing members', () => {
  const check = {
    rows: [{ code: 'ok' as const }],
    code: null,
    omittedLinks: [],
    remainingInvitations: 0,
    invitationsRequired: 1,
  }
  expect(staffBatchProblem(check)).toBe(
    'Only 0 invitations remain. This batch needs 1. Remove some people before adding.',
  )
  expect(staffBatchProblem({ ...check, invitationsRequired: 0 })).toBeNull()
})
