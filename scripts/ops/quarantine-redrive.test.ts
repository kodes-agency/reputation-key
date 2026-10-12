import { describe, expect, it } from 'vitest'
import {
  parseOperatorArgs,
  validateOperatorArgs,
} from '../../src/shared/ops/operator-command'
import { quarantineCommandSpec, type QuarantineAction } from './quarantine-redrive'

const JOB = 'quarantine-job-1'

/** The usage error the harness answers this invocation with; null = runnable. */
function refusal(action: QuarantineAction, flags: readonly string[]): string | null {
  const spec = quarantineCommandSpec(action)
  const parsed = parseOperatorArgs([action, JOB, '--operator', 'op-1', ...flags], spec)
  if (!parsed.ok) return parsed.error
  return validateOperatorArgs(spec, parsed.args)
}

describe('ops:quarantine invocation contract', () => {
  // Discard removes the dead-lettered job for good: nothing executes it and
  // nothing can bring it back. It is the one destructive disposition.
  it('discard --apply needs the typed confirmation as well as a reason', () => {
    expect(refusal('discard', ['--reason', 'blocked family', '--apply'])).toBe(
      'destructive command — confirm with --yes ops:quarantine',
    )
    expect(
      refusal('discard', ['--reason', 'blocked family', '--apply', '--yes', 'discard']),
    ).toBe('destructive command — confirm with --yes ops:quarantine')
    expect(
      refusal('discard', [
        '--reason',
        'blocked family',
        '--apply',
        '--yes',
        'ops:quarantine',
      ]),
    ).toBeNull()
  })

  it('discard still reports without a reason or a confirmation', () => {
    expect(refusal('discard', [])).toBeNull()
  })

  // Redrive returns the job to its queue; the entry is not lost.
  it('redrive --apply needs a reason and no typed confirmation', () => {
    expect(refusal('redrive', ['--apply'])).toContain('--reason <text> is required')
    expect(refusal('redrive', ['--reason', 'handler fixed', '--apply'])).toBeNull()
  })

  it('list is a read', () => {
    expect(quarantineCommandSpec('list')).toMatchObject({
      name: 'ops:quarantine',
      scope: 'global',
      mutation: false,
    })
    expect(refusal('list', ['--apply'])).toContain('--apply is only valid for mutation')
  })
})
