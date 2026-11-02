import { act, createElement } from 'react'
import { it, expect, vi } from 'vitest'
import { setupHookRoot } from '#/shared/testing/hook-root'
import { useStaffBatch } from './use-staff-batch'
import { newStaffRow } from './staff-batch'
import type { StaffAddFormProps } from './staff-add-form'
vi.mock('#/components/ui/dialog-dismissal', () => ({ useDialogBusy: () => undefined }))
const root = setupHookRoot()
const drafts = ['one', 'two'].map((operationId) => ({
  ...newStaffRow(operationId),
  email: `${operationId}@example.com`,
  displayName: operationId,
}))
const checked = {
  code: null,
  rows: drafts.map(() => ({ code: 'ok' })),
  omittedLinks: [],
  remainingInvitations: 20,
  invitationsRequired: 2,
}
async function mount(check: StaffAddFormProps['check'], add: StaffAddFormProps['add']) {
  let state: ReturnType<typeof useStaffBatch>
  function Probe() {
    state = useStaffBatch({
      propertyId: 'property',
      portals: [],
      groups: [],
      initialRows: drafts,
      check,
      add,
    })
    return null
  }
  await root.render(createElement(Probe))
  return () => state!
}
it('checks before sending and blocks the entire batch when one row is refused', async () => {
  const add = vi.fn()
  const check = vi.fn().mockResolvedValue({
    ...checked,
    rows: [{ code: 'already_invited' }, { code: 'ok' }],
  })
  const state = await mount(check, add)
  await act(async () => state().submit())
  expect(check).toHaveBeenCalledOnce()
  expect(add).not.toHaveBeenCalled()
  expect(state().rows[0]?.problem).toContain('open invitation')
})
it('continues after a row fails and retries with the same operation id', async () => {
  const add = vi
    .fn()
    .mockRejectedValueOnce(new Error('Setup failed.'))
    .mockResolvedValue({ status: 'done', access: 'invited' })
  const state = await mount(vi.fn().mockResolvedValue(checked), add)
  await act(async () => state().submit())
  expect(state().rows.map((row) => row.state)).toEqual(['failed', 'invited'])
  await act(async () => state().retry(state().rows[0]!))
  expect(add.mock.calls.map((call) => call[0].data.operationId)).toEqual([
    'one',
    'two',
    'one',
  ])
  expect(state().rows[0]?.state).toBe('invited')
})
it('ignores double submit while the check is pending', async () => {
  const pending = Promise.withResolvers<typeof checked>()
  const check = vi.fn().mockReturnValue(pending.promise)
  const add = vi.fn().mockResolvedValue({ status: 'done', access: 'active' })
  const state = await mount(check, add)
  let sending: Promise<void>
  await act(async () => {
    sending = state().submit()
    await state().submit()
  })
  expect(check).toHaveBeenCalledOnce()
  expect(add).not.toHaveBeenCalled()
  await act(async () => {
    pending.resolve(checked)
    await sending
  })
  expect(add).toHaveBeenCalledTimes(2)
})
