import { describe, expect, it } from 'vitest'
import {
  PRIVACY_REQUEST_COMMAND,
  planPrivacyRequestCommand,
  privacyRequestCommandSpec,
} from './privacy-request-command'
import {
  OPERATOR_ACTION,
  parseOperatorArgs,
  validateOperatorArgs,
  type OperatorArgs,
  type OperatorContext,
} from '../operator-command'
import type { ExecutionDecision } from '#/shared/auth/execution-policy'

const ORG = 'org-privacy-cli'
const PROPERTY = '90000000-0000-4000-8000-000000000001'
const SUBJECT = 'a'.repeat(64)

const ALLOW = {
  allowed: true,
  reason: 'allowed',
  action: OPERATOR_ACTION,
  policyVersion: 'bqc-7.5',
} as ExecutionDecision

function parse(argv: readonly string[]): OperatorArgs {
  const parsed = parseOperatorArgs(argv, privacyRequestCommandSpec)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.args
}

const ctx = (dryRun: boolean, scoped = true): OperatorContext =>
  ({
    operatorId: 'ops-privacy',
    correlationId: 'corr-1',
    ...(scoped ? { organizationId: ORG, propertyId: PROPERTY } : {}),
    dryRun,
    decision: ALLOW,
  }) as OperatorContext

const base = ['--operator', 'ops-privacy', '--org', ORG, '--property', PROPERTY]

describe('privacy request operator command (LIF-01-T20)', () => {
  it('is report-only by default and destructive plus ticket-bearing on apply', () => {
    expect(privacyRequestCommandSpec.mutation).toBe(true)
    expect(privacyRequestCommandSpec.destructive).toBe(true)
    expect(privacyRequestCommandSpec.requiresTicket).toBe(true)

    const applied = parse([
      'receive',
      ...base,
      '--reason',
      'subject request',
      '--ticket',
      'zd-1',
      '--apply',
    ])
    expect(validateOperatorArgs(privacyRequestCommandSpec, applied)).toMatch(
      new RegExp(`--yes ${PRIVACY_REQUEST_COMMAND}`, 'u'),
    )
  })

  it('is tenant and property scoped', () => {
    expect(privacyRequestCommandSpec.scope).toBe('property')
    expect(
      planPrivacyRequestCommand(ctx(true, false), parse(['report', ...base])),
    ).toMatchObject({ ok: false, error: expect.stringContaining('--property') })
  })

  it('refuses a subject identifier that is not a digest', () => {
    // A pasted email address would land in the shell history, the audit trail
    // and the request row at once.
    const args = parse([
      'receive',
      ...base,
      'subject-ref=guest@example.com',
      'kind=access',
    ])
    expect(planPrivacyRequestCommand(ctx(false), args)).toMatchObject({
      ok: false,
      error: expect.stringContaining('SHA-256'),
    })
  })

  it('refuses a correction field that carries a value', () => {
    const args = parse([
      'receive',
      ...base,
      `subject-ref=${SUBJECT}`,
      'kind=correction',
      'field=the room smelled of smoke',
    ])
    expect(planPrivacyRequestCommand(ctx(false), args)).toMatchObject({
      ok: false,
      error: expect.stringContaining('never a value'),
    })
  })

  it('requires identity verification evidence to verify', () => {
    expect(
      planPrivacyRequestCommand(ctx(false), parse(['verify', ...base, 'request=req-1'])),
    ).toMatchObject({ ok: false, error: expect.stringContaining('verification') })

    expect(
      planPrivacyRequestCommand(
        ctx(false),
        parse(['verify', ...base, 'request=req-1', 'verification=told me on the phone']),
      ),
    ).toMatchObject({ ok: false })

    expect(
      planPrivacyRequestCommand(
        ctx(false),
        parse([
          'verify',
          ...base,
          'request=req-1',
          'verification=privacy:verify:magic-link',
        ]),
      ),
    ).toMatchObject({ ok: true, plan: { mode: 'verify' } })
  })

  it('requires an enumerated refusal reason code', () => {
    expect(
      planPrivacyRequestCommand(
        ctx(false),
        parse([
          'refuse',
          ...base,
          'request=req-1',
          'reason-code=we did not feel like it',
        ]),
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining('reason-code') })

    expect(
      planPrivacyRequestCommand(
        ctx(false),
        parse(['refuse', ...base, 'request=req-1', 'reason-code=legal_hold']),
      ),
    ).toMatchObject({ ok: true, plan: { refusalReasonCode: 'legal_hold' } })
  })

  it('plans a report without demanding subject evidence', () => {
    expect(
      planPrivacyRequestCommand(ctx(true), parse(['report', ...base])),
    ).toMatchObject({
      ok: true,
      plan: { mode: 'report', reportOnly: true },
    })
  })
})
