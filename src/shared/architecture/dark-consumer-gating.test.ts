// BQC-5.6: dark contexts stay dark — consumer/job gating pin.
//
// Dark (beta-gated) contexts must not acquire always-on delayed entry
// points: every catalogue consumer or job whose implementation lives in a
// dark context carries a capability gate (never 'none'), so a dark context
// cannot be pulled into an enabled bundle by registration. The known
// pairings are pinned below; any FUTURE dark-context consumer/job must be
// gated as well — this test fails on the first ungated row.
//
// Asserts against the catalogue module's exported data (no file re-parsing).

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ENTRY_POINT_CATALOGUE } from '#/shared/governance/entry-point-catalogue'

/** Beta-dark contexts (ADR 0032); 'ai' reserved — no context directory yet. */
const DARK_CONTEXTS = ['team', 'portal', 'guest', 'goal', 'badge', 'leaderboard', 'ai']

const darkRows = ENTRY_POINT_CATALOGUE.filter(
  (row) =>
    (row.kind === 'consumer' || row.kind === 'job') &&
    DARK_CONTEXTS.some((ctx) => row.file.startsWith(`src/contexts/${ctx}/`)),
)

const ALWAYS_ON_CONTAINMENT_JOBS = new Set(['job:portal-upload-source-cleanup'])

describe('architecture: dark-context consumers and jobs are capability-gated (BQC-5.6)', () => {
  it('every dark-context consumer/job row carries a gate (never none)', () => {
    const ungated = darkRows
      .filter(
        (row) => row.capability === 'none' && !ALWAYS_ON_CONTAINMENT_JOBS.has(row.id),
      )
      .map((row) => `${row.id} (${row.file})`)
    expect(
      ungated,
      'dark-context consumers/jobs must be capability-gated:\n' + ungated.join('\n'),
    ).toEqual([])
  })

  it('pins the known dark consumer/job pairings', () => {
    const pairings = Object.fromEntries(darkRows.map((row) => [row.name, row.capability]))
    expect(pairings).toMatchObject({
      'process-image': 'portal.upload',
      'portal-upload-source-cleanup': 'none',
    })
    expect(pairings).not.toHaveProperty('badge.event-handlers')
    expect(pairings).not.toHaveProperty('leaderboard.event-handlers')
  })

  it('keeps the legacy Goal handler disconnected and Recognition consumers removed', () => {
    const composition = readFileSync(resolve('src/composition.ts'), 'utf8')

    expect(composition).not.toContain('registerGoalEventHandlers')
    expect(
      [
        'src/contexts/badge/infrastructure/event-handlers/index.ts',
        'src/contexts/leaderboard/infrastructure/event-handlers/index.ts',
      ].filter((path) => existsSync(resolve(path))),
    ).toEqual([])
  })
})
