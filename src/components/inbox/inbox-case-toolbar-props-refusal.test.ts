// A refused toolbar command, in a file of its own: the suite for the rest of
// the selector, `inbox-case-toolbar-props.test.ts`, stands at the edge of the
// 300 counted lines ESLint `max-lines` allows under `src/components`.
//
// The fixtures are the smallest input `buildInboxCaseToolbarProps` reads,
// repeated rather than imported from the base suite: a test file exporting
// helpers would be a module other suites could start to lean on.
import { describe, expect, it } from 'vitest'
import {
  buildInboxCaseToolbarProps,
  type InboxCaseToolbarInput,
} from './inbox-case-toolbar-props'
import type { InboxItem } from '#/contexts/inbox/application/public-api'

const idle = () =>
  Object.assign(async () => undefined, {
    isPending: false,
    error: null,
    isSuccess: false,
    data: null,
  })

function makeInput(overrides: Partial<InboxCaseToolbarInput>): InboxCaseToolbarInput {
  return {
    updateStatus: idle(),
    escalate: idle(),
    resolveEscalation: idle(),
    assign: idle(),
    markFeedbackHandled: idle(),
    correctFeedbackHandlingOutcome: idle(),
    item: {
      id: 'item-1',
      commandRevision: 3,
      isEscalated: false,
      escalationResolvedAt: null,
    } as unknown as InboxItem,
    detail: null,
    assignmentOptions: [],
    onReopen: () => {},
    ...overrides,
  } as unknown as InboxCaseToolbarInput
}

describe('a refused toolbar command', () => {
  // The toolbar hands the strip `() => void`, so the promise has nowhere to go
  // and a bare `void` left every refusal unhandled. What TELLS the manager is
  // the command's `errorMessage` toast; this pins that nothing escapes.
  //
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

  type Props = ReturnType<typeof buildInboxCaseToolbarProps>
  it.each([
    ['assign', (props: Props) => props.onAssign('user-georgi')],
    ['escalate', (props: Props) => props.onEscalate()],
    ['resolveEscalation', (props: Props) => props.onResolveEscalation()],
  ] as const)('%s is caught rather than left unhandled', async (name, click) => {
    const unhandled: unknown[] = []
    const listen = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', listen)
    try {
      const { command, calls } = refused()
      const input = makeInput({ [name]: command } as Partial<InboxCaseToolbarInput>)

      click(buildInboxCaseToolbarProps(input))
      await new Promise((resolve) => setImmediate(resolve))

      expect(calls).toHaveLength(1)
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', listen)
    }
  })
})
