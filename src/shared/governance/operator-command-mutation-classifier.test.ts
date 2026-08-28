import { describe, expect, it } from 'vitest'
import { ENTRY_POINT_CATALOGUE } from './entry-point-catalogue'
import {
  classifyOperatorCommandMutation,
  REVIEWED_OPERATOR_COMMAND_NAMES,
} from './operator-command-mutation-classifier'

const catalogueOperatorNames = ENTRY_POINT_CATALOGUE.filter(
  (entry) => entry.kind === 'operator_command',
)
  .map((entry) => entry.name)
  .sort()

describe('operator command mutation classifier', () => {
  it('classifies every current operator command by exact name', () => {
    expect(REVIEWED_OPERATOR_COMMAND_NAMES).toEqual(catalogueOperatorNames)
    expect(
      catalogueOperatorNames.filter(
        (name) => classifyOperatorCommandMutation(name) === undefined,
      ),
    ).toEqual([])
  })

  it('fails closed for plausible but unreviewed command names', () => {
    expect(classifyOperatorCommandMutation('scripts/check-new-gate.mjs')).toBeUndefined()
    expect(
      classifyOperatorCommandMutation('scripts/ops/new-emergency-repair.ts'),
    ).toBeUndefined()
    expect(classifyOperatorCommandMutation('db:drop')).toBeUndefined()
  })

  it('distinguishes diagnostics, local effects, atomic commands, and defects', () => {
    expect(classifyOperatorCommandMutation('scripts/check-db.ts')).toEqual({
      kind: 'read_only',
    })
    expect(
      classifyOperatorCommandMutation('scripts/generate-ai-language-script-table.ts'),
    ).toMatchObject({
      kind: 'mutation',
      stateOwner: 'operations',
      disposition: 'local_only_with_reason',
    })
    expect(
      classifyOperatorCommandMutation('scripts/ops/disconnect-connection.ts'),
    ).toMatchObject({
      kind: 'mutation',
      stateOwner: 'operations',
      disposition: 'atomic_state_and_fact',
    })
    expect(
      classifyOperatorCommandMutation('scripts/ops/property-suspension.ts'),
    ).toMatchObject({
      kind: 'mutation',
      stateOwner: 'operations',
      disposition: 'atomic_state_and_fact',
    })
    expect(
      classifyOperatorCommandMutation('scripts/ops/triage-beta-feedback.ts'),
    ).toMatchObject({
      kind: 'mutation',
      stateOwner: 'operations',
      disposition: 'atomic_state_and_fact',
    })
    expect(
      classifyOperatorCommandMutation('scripts/ops/manage-dormant-billing-data.ts'),
    ).toMatchObject({
      kind: 'mutation',
      stateOwner: 'operations',
      disposition: 'local_only_with_reason',
    })
    expect(
      classifyOperatorCommandMutation(
        'scripts/ops/reconcile-recent-activity-vocabulary.ts',
      ),
    ).toMatchObject({
      kind: 'mutation',
      stateOwner: 'operations',
      disposition: 'local_only_with_reason',
    })
    expect(classifyOperatorCommandMutation('db:studio')).toBeUndefined()
  })

  it('does not call harness-audited reports read-only', () => {
    expect(
      classifyOperatorCommandMutation('scripts/ops/report-people-authority.ts'),
    ).toMatchObject({
      kind: 'mutation',
      disposition: 'local_only_with_reason',
    })
    expect(
      classifyOperatorCommandMutation('scripts/ops/report-portal-beta-readiness.ts'),
    ).toMatchObject({
      kind: 'mutation',
      disposition: 'local_only_with_reason',
    })
    expect(
      classifyOperatorCommandMutation('scripts/ops/report-guest-response-readiness.ts'),
    ).toMatchObject({
      kind: 'mutation',
      disposition: 'local_only_with_reason',
    })
    expect(
      classifyOperatorCommandMutation('scripts/ops/report-legacy-goals.ts'),
    ).toMatchObject({
      kind: 'mutation',
      disposition: 'local_only_with_reason',
    })
    expect(
      classifyOperatorCommandMutation('scripts/ops/report-legacy-people-team.ts'),
    ).toMatchObject({
      kind: 'mutation',
      disposition: 'local_only_with_reason',
    })
    expect(
      classifyOperatorCommandMutation('scripts/ops/report-legacy-recognition.ts'),
    ).toMatchObject({
      kind: 'mutation',
      disposition: 'local_only_with_reason',
    })
  })

  it('gives every mutating classification an actionable semantic reason', () => {
    for (const name of REVIEWED_OPERATOR_COMMAND_NAMES) {
      const classification = classifyOperatorCommandMutation(name)
      if (!classification || classification.kind === 'read_only') continue
      expect(classification.reason, name).toMatch(/\S/u)
      expect(classification.reason.length, name).toBeGreaterThan(40)
    }
  })
})
