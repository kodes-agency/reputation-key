// The `e` shortcut's commands, refused. The toolbar's copy of this guard is
// pinned in `inbox-case-toolbar-props-refusal.test.ts`; the key issues the same
// two Actions down its own path (`use-inbox-page.ts` builds it,
// `use-inbox-keyboard-shortcuts.ts` `runEscalation` calls it), so it
// needs the same proof. Rather than render the hook, this drives the hook-free
// binder it spreads into its result — the part that issues the commands.
import { describe, expect, it } from 'vitest'
import { bindEscalationShortcutCommands } from './use-inbox-escalation-shortcut'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import type { InboxDetailState } from './use-inbox-detail'

type Commands = Pick<InboxDetailState, 'escalate' | 'resolveEscalation'>

const item = { id: 'item-1', commandRevision: 3 } as unknown as InboxItem

// A plain function, not `vi.fn()`: a spy attaches its own handler to the
// promise it returns (to record `settledResults`), so a rejection from one is
// never unhandled and the test could not fail.
function refused() {
  const calls: unknown[] = []
  const command = Object.assign(
    (input: unknown) => {
      calls.push(input)
      return Promise.reject(new Error('forbidden'))
    },
    { isPending: false, error: null, isSuccess: false, data: null },
  )
  return { command, calls }
}

async function collectUnhandled(press: () => void): Promise<unknown[]> {
  const unhandled: unknown[] = []
  const listen = (reason: unknown) => unhandled.push(reason)
  process.on('unhandledRejection', listen)
  try {
    press()
    // Node reports an unhandled rejection after the microtask queue drains;
    // one macrotask later it has either fired or never will.
    await new Promise((resolve) => setImmediate(resolve))
    return unhandled
  } finally {
    process.off('unhandledRejection', listen)
  }
}

describe('a refused `e` shortcut command', () => {
  it.each(['escalate', 'resolveEscalation'] as const)(
    '%s is caught rather than left unhandled',
    async (name) => {
      const { command, calls } = refused()
      const other = refused().command
      const commands = { escalate: other, resolveEscalation: other, [name]: command }
      const bound = bindEscalationShortcutCommands(item, commands as unknown as Commands)

      const unhandled = await collectUnhandled(() => bound[name]())

      expect(calls).toEqual([
        { data: { inboxItemId: 'item-1', expectedCommandRevision: 3 } },
      ])
      expect(unhandled).toEqual([])
    },
  )

  it('issues nothing without an item', async () => {
    const { command, calls } = refused()
    const commands = { escalate: command, resolveEscalation: command }
    const bound = bindEscalationShortcutCommands(null, commands as unknown as Commands)

    const unhandled = await collectUnhandled(() => {
      bound.escalate()
      bound.resolveEscalation()
    })

    expect(calls).toEqual([])
    expect(unhandled).toEqual([])
  })
})
