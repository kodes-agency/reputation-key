import { describe, expect, it } from 'vitest'
import { COMMANDS } from './commands'
import {
  REPUBLISH_LEGACY_PORTALS_SPEC,
  createRepublishLegacyPortalsAction,
  renderRepublishReport,
} from './republish-legacy-portals'
import { organizationId, portalId, propertyId } from '../../src/shared/domain/ids'
import type {
  RepublishLegacyPortalRow,
  RepublishLegacyPortalsInput,
  RepublishLegacyPortalsReport,
} from '../../src/contexts/portal/application/use-cases/republish-legacy-portals'
import type { OperatorArgs, OperatorContext } from '../../src/shared/ops/operator-command'

const ORG = organizationId('org-ops-republish-0000000000000001')
const PROPERTY = propertyId('a0000000-0000-4000-8000-00000000000a')
const scope = (index: number) => ({
  organizationId: ORG,
  propertyId: PROPERTY,
  portalId: portalId(`c0000000-0000-4000-8000-${String(index).padStart(12, '0')}`),
  fromVersion: 3,
  fromSchemaVersion: 2 as const,
})

const rows: ReadonlyArray<RepublishLegacyPortalRow> = [
  { ...scope(1), outcome: 'republished', toVersion: 4 },
  {
    ...scope(2),
    outcome: 'skipped',
    reason: { code: 'token_unavailable', message: 'Create the Portal public address' },
  },
]

const totals = {
  selected: 2,
  republished: 1,
  wouldRepublish: 0,
  skipped: 1,
  unchanged: 0,
  failed: 0,
}

const report = (overrides: Partial<RepublishLegacyPortalsReport> = {}) =>
  ({
    mode: 'apply',
    rows,
    totals,
    halted: null,
    ...overrides,
  }) as RepublishLegacyPortalsReport

function harness(
  result: RepublishLegacyPortalsReport,
  ctx: Partial<OperatorContext> = {},
) {
  const calls: RepublishLegacyPortalsInput[] = []
  const out: string[] = []
  const action = createRepublishLegacyPortalsAction(() => async (input) => {
    calls.push(input)
    return result
  })
  const operatorContext = {
    operatorId: 'denev',
    correlationId: 'corr-1',
    organizationId: ORG,
    dryRun: true,
    batchSize: 50,
    ...ctx,
  } as OperatorContext & { container: never }
  return {
    calls,
    out,
    run: () =>
      action(
        { ...operatorContext, container: {} as never },
        { positionals: [] } as unknown as OperatorArgs,
        { out: (line) => out.push(line), err: (line) => out.push(`ERR ${line}`) },
      ),
  }
}

describe('ops republish-legacy-portals', () => {
  it('is registered in the command table and dry-run by default', () => {
    expect(COMMANDS['republish-legacy-portals']).toEqual([
      'scripts/ops/republish-legacy-portals.ts',
    ])
    expect(REPUBLISH_LEGACY_PORTALS_SPEC).toMatchObject({
      scope: 'org',
      mutation: true,
      capability: 'portal.write',
    })
    expect(REPUBLISH_LEGACY_PORTALS_SPEC.usage).toContain('--org <id>')
  })

  it('passes the organisation, the operator and the mode through, and a dry run is the default', async () => {
    const test = harness(report({ mode: 'dry_run' }))

    await test.run()

    expect(test.calls).toEqual([
      {
        organizationId: ORG,
        propertyId: undefined,
        operatorId: 'denev',
        dryRun: true,
        pageSize: 50,
      },
    ])
  })

  it('applies only when the harness says it is not a dry run, and narrows to a Property', async () => {
    const test = harness(report(), { dryRun: false, propertyId: PROPERTY })

    await test.run()

    expect(test.calls[0]).toMatchObject({ dryRun: false, propertyId: PROPERTY })
  })

  it('reports each portal on its own line, with the reason for a skipped one, then the totals', async () => {
    const test = harness(report(), { dryRun: false })

    const code = await test.run()

    expect(code ?? 0).toBe(0)
    expect(test.out).toEqual([
      `portal=${scope(1).portalId} property=${PROPERTY} v3 (schema 2) republished -> v4`,
      `portal=${scope(2).portalId} property=${PROPERTY} v3 (schema 2) skipped: token_unavailable - Create the Portal public address`,
      JSON.stringify(totals),
    ])
  })

  it('points a dry run at the apply flags', async () => {
    const test = harness(report({ mode: 'dry_run' }))

    await test.run()

    expect(test.out.at(-1)).toBe(
      'report only - re-run with --reason <text> --apply to republish',
    )
  })

  it('exits 1 and names the Portal when the run stopped at a fault', async () => {
    const test = harness(
      report({
        rows: [{ ...scope(1), outcome: 'failed' }],
        totals: { ...totals, selected: 1, republished: 0, skipped: 0, failed: 1 },
        halted: { portalId: scope(1).portalId, fault: 'TypeError' },
      }),
    )

    const code = await test.run()

    expect(code).toBe(1)
    expect(test.out.join('\n')).toContain(
      `stopped at portal=${scope(1).portalId}: TypeError`,
    )
  })

  it('renders an empty selection plainly', () => {
    expect(
      renderRepublishReport(
        report({
          rows: [],
          totals: { ...totals, selected: 0, republished: 0, skipped: 0 },
        }),
      ),
    ).toEqual([
      'no live portal is still on a version 1 or 2 page',
      JSON.stringify({ ...totals, selected: 0, republished: 0, skipped: 0 }),
    ])
  })
})
