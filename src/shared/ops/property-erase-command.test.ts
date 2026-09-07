// LIF-01-T19 — the operator command contract for permanent Property Erase.
//
// This is the ONLY authorization path into an irreversible erasure, so it must
// be covered by tests that actually run. `scripts/**` is not in the unit test
// project, which is exactly why the contract lives in `src/shared/ops`.

import { describe, expect, it, vi } from 'vitest'
import {
  PROPERTY_ERASE_COMMAND,
  planPropertyEraseCommand,
  propertyEraseCommandSpec,
} from './property-erase-command'
import {
  OPERATOR_ACTION,
  parseOperatorArgs,
  runOperatorCommand,
  validateOperatorArgs,
  type OperatorArgs,
  type OperatorContext,
  type OperatorIO,
  type OperatorRuntime,
} from './operator-command'
import type { DecisionRequest, ExecutionDecision } from '#/shared/auth/execution-policy'

const ORG = 'org-erase-cli'
const PROPERTY = '70000000-0000-4000-8000-000000000001'

const ALLOW: ExecutionDecision = {
  allowed: true,
  reason: 'allowed',
  action: OPERATOR_ACTION,
  policyVersion: 'bqc-7.5',
} as ExecutionDecision

function memoryIO(): OperatorIO & { outLines: string[]; errLines: string[] } {
  const outLines: string[] = []
  const errLines: string[] = []
  return {
    outLines,
    errLines,
    out: (line) => void outLines.push(line),
    err: (line) => void errLines.push(line),
  }
}

function parse(argv: readonly string[]): OperatorArgs {
  const parsed = parseOperatorArgs(argv, propertyEraseCommandSpec)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.args
}

const ctx = (dryRun: boolean): OperatorContext =>
  ({
    operatorId: 'ops-erase',
    correlationId: 'corr-1',
    organizationId: ORG,
    propertyId: PROPERTY,
    dryRun,
    decision: ALLOW,
  }) as OperatorContext

describe('property erase operator command spec (LIF-01-T19)', () => {
  it('is report-only by default and destructive plus ticket-bearing on apply', () => {
    expect(propertyEraseCommandSpec.mutation).toBe(true)
    expect(propertyEraseCommandSpec.destructive).toBe(true)
    expect(propertyEraseCommandSpec.requiresTicket).toBe(true)

    const args = parse([
      'request',
      '--operator',
      'ops-erase',
      '--org',
      ORG,
      '--property',
      PROPERTY,
    ])
    expect(validateOperatorArgs(propertyEraseCommandSpec, args)).toBeNull()
    // Without --apply the harness reports and writes nothing.
    expect(args.apply).toBe(false)
  })

  it('declares no capability, because property.erase stays blocked', () => {
    // A capability gate here would imply a capability that could be granted to
    // a tenant. The authorization is the operator plus support authorization.
    expect(propertyEraseCommandSpec.capability).toBeUndefined()
  })

  it('requires a registered operator, a reason, a ticket and typed confirmation on apply', () => {
    const missingOperator = parse([
      'request',
      '--org',
      ORG,
      '--property',
      PROPERTY,
      '--apply',
    ])
    expect(validateOperatorArgs(propertyEraseCommandSpec, missingOperator)).toMatch(
      /--operator/u,
    )

    const missingReason = parse([
      'request',
      '--operator',
      'ops-erase',
      '--org',
      ORG,
      '--property',
      PROPERTY,
      '--apply',
    ])
    expect(validateOperatorArgs(propertyEraseCommandSpec, missingReason)).toMatch(
      /--reason/u,
    )

    const missingTicket = parse([
      'request',
      '--operator',
      'ops-erase',
      '--org',
      ORG,
      '--property',
      PROPERTY,
      '--reason',
      'account admin request',
      '--apply',
    ])
    expect(validateOperatorArgs(propertyEraseCommandSpec, missingTicket)).toMatch(
      /--ticket/u,
    )

    const missingYes = parse([
      'request',
      '--operator',
      'ops-erase',
      '--org',
      ORG,
      '--property',
      PROPERTY,
      '--reason',
      'account admin request',
      '--ticket',
      'zd-88213',
      '--apply',
    ])
    expect(validateOperatorArgs(propertyEraseCommandSpec, missingYes)).toMatch(
      new RegExp(`--yes ${PROPERTY_ERASE_COMMAND}`, 'u'),
    )

    const complete = parse([
      'request',
      '--operator',
      'ops-erase',
      '--org',
      ORG,
      '--property',
      PROPERTY,
      '--reason',
      'account admin request',
      '--ticket',
      'zd-88213',
      '--apply',
      '--yes',
      PROPERTY_ERASE_COMMAND,
    ])
    expect(validateOperatorArgs(propertyEraseCommandSpec, complete)).toBeNull()
  })

  it('passes a content-free authorization request for the invocation', async () => {
    const decide = vi.fn(async (_request: DecisionRequest) => ALLOW)
    const runtime: OperatorRuntime = { decide, newCorrelationId: () => 'corr-decision' }
    const io = memoryIO()
    const result = await runOperatorCommand(
      propertyEraseCommandSpec,
      async () => 0,
      runtime,
      ['report', '--operator', 'ops-erase', '--org', ORG, '--property', PROPERTY],
      io,
    )
    expect(result.exitCode).toBe(0)
    const request = decide.mock.calls[0]?.[0]
    expect(request).toMatchObject({
      principal: { kind: 'operator', id: 'ops-erase' },
      action: OPERATOR_ACTION,
      executionKind: 'operator',
      organizationId: ORG,
      propertyId: PROPERTY,
      correlationId: 'corr-decision',
      reason: 'dry-run',
    })
    expect(io.outLines[0]).toContain('mode=dry-run')
  })
})

describe('property erase command plan (LIF-01-T19)', () => {
  it('defaults to a report that plans no writes', () => {
    const plan = planPropertyEraseCommand(
      ctx(true),
      parse(['--operator', 'ops-erase', '--org', ORG, '--property', PROPERTY]),
    )
    expect(plan).toMatchObject({ ok: true, plan: { mode: 'report', reportOnly: true } })
  })

  it('refuses a request without an independent support authorization', () => {
    const args = parse([
      'request',
      '--operator',
      'ops-erase',
      '--org',
      ORG,
      '--property',
      PROPERTY,
      'identity-verification=identity:webauthn:1',
      'requested-by=user-admin',
    ])
    expect(planPropertyEraseCommand(ctx(false), args)).toMatchObject({
      ok: false,
      error: expect.stringContaining('support-authorization'),
    })

    const sameRef = parse([
      'request',
      '--operator',
      'ops-erase',
      '--org',
      ORG,
      '--property',
      PROPERTY,
      'identity-verification=identity:webauthn:1',
      'support-authorization=identity:webauthn:1',
      'requested-by=user-admin',
    ])
    expect(planPropertyEraseCommand(ctx(false), sameRef)).toMatchObject({
      ok: false,
      error: expect.stringContaining('independent'),
    })
  })

  it('refuses free text in an authorization reference', () => {
    const args = parse([
      'request',
      '--operator',
      'ops-erase',
      '--org',
      ORG,
      '--property',
      PROPERTY,
      'identity-verification=identity:webauthn:1',
      'requested-by=user-admin',
      'support-authorization=agreed with jane on the phone',
    ])
    expect(planPropertyEraseCommand(ctx(false), args)).toMatchObject({ ok: false })
  })

  it('requires the typed confirmation and the inventory revision to confirm', () => {
    const noConfirmation = parse([
      'confirm',
      '--operator',
      'ops-erase',
      '--org',
      ORG,
      '--property',
      PROPERTY,
      'authority=abc',
    ])
    expect(planPropertyEraseCommand(ctx(false), noConfirmation)).toMatchObject({
      ok: false,
      error: expect.stringContaining('typed-confirmation'),
    })

    const noRevision = parse([
      'confirm',
      '--operator',
      'ops-erase',
      '--org',
      ORG,
      '--property',
      PROPERTY,
      'authority=abc',
      `typed-confirmation=ERASE PROPERTY ${PROPERTY}`,
    ])
    expect(planPropertyEraseCommand(ctx(false), noRevision)).toMatchObject({
      ok: false,
      error: expect.stringContaining('inventory-revision'),
    })
  })

  it('does not demand authorization evidence for a report', () => {
    // The report is how an operator checks what an erasure would touch. Making
    // it need the authorization would push people to run the mutating path.
    const args = parse([
      'request',
      '--operator',
      'ops-erase',
      '--org',
      ORG,
      '--property',
      PROPERTY,
    ])
    expect(planPropertyEraseCommand(ctx(true), args)).toMatchObject({ ok: true })
  })
})
