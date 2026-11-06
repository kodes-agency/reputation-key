import { describe, expect, it, vi } from 'vitest'
import { runWorkCommand, workCommandSpec } from './work-command'
import { runOperatorCommand, type OperatorRuntime } from './operator-command'
import type { WorkItems } from '#/shared/jobs/work-items.server'

const id = '00000000-0000-4000-8000-000000000001'
const runtime: OperatorRuntime = {
  decide: async () => ({
    allowed: true,
    reason: 'allowed',
    action: 'system:ops',
    policyVersion: 'test',
  }),
}

function fixture() {
  const store: Pick<WorkItems, 'list' | 'inspect' | 'operate'> = {
    list: vi.fn().mockResolvedValue([]),
    inspect: vi.fn().mockResolvedValue({ id, state: 'quarantined' }),
    operate: vi.fn().mockResolvedValue({ id, state: 'pending' }),
  }
  const io = { out: vi.fn(), err: vi.fn() }
  const run = (action: string, flags: string[] = [], access = runtime) =>
    runOperatorCommand(
      workCommandSpec(action),
      (ctx, args) => runWorkCommand({ store, ctx, args, io }),
      access,
      [
        action,
        ...(action === 'list' ? [] : [id]),
        '--operator',
        'operator',
        '--org',
        'org-a',
        ...flags,
      ],
      io,
    )
  return { store, io, run }
}

describe('work operator command', () => {
  it('reads only the requested tenant and never mutates on a dry run', async () => {
    const { run, store } = fixture()
    expect((await run('list')).exitCode).toBe(0)
    expect(store.list).toHaveBeenCalledWith('org-a')
    expect((await run('retry')).exitCode).toBe(0)
    expect(store.inspect).toHaveBeenCalledWith('org-a', id)
    expect(store.operate).not.toHaveBeenCalled()
  })
  it.each(['retry', 'cancel', 'discard'])(
    'requires a reason and explicit apply for %s',
    async (action) => {
      const { run, store } = fixture()
      expect((await run(action, ['--apply'])).exitCode).toBe(1)
      expect(store.operate).not.toHaveBeenCalled()
      expect(
        (await run(action, ['--reason', 'Provider state checked', '--apply'])).exitCode,
      ).toBe(0)
      expect(store.operate).toHaveBeenCalledWith(
        'org-a',
        id,
        action,
        'operator',
        'Provider state checked',
      )
    },
  )
  it('keeps policy denials ahead of every storage call', async () => {
    const { run, store } = fixture()
    const denied: OperatorRuntime = {
      decide: async () => ({
        allowed: false,
        reason: 'operator_not_registered',
        action: 'system:ops',
        policyVersion: 'test',
      }),
    }
    expect((await run('inspect', [], denied)).exitCode).toBe(1)
    expect(store.inspect).not.toHaveBeenCalled()
  })
  it('reports a refused transition without claiming it succeeded', async () => {
    const { run, store } = fixture()
    vi.mocked(store.operate).mockResolvedValue(undefined)
    expect((await run('retry', ['--reason', 'Checked', '--apply'])).exitCode).toBe(1)
  })
  it('rejects an unknown action before reading an item', async () => {
    const { run, store } = fixture()
    expect((await run('purge')).exitCode).toBe(1)
    expect(store.inspect).not.toHaveBeenCalled()
  })
})
