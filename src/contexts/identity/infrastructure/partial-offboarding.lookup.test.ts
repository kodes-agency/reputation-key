// LIF-01-T21 — contract tests for the read behind `repairPartialOffboarding`.
//
// The lookup is the only place the crash signature is turned into a domain
// observation, so two things are tested here: row mapping (driver strings and
// nulls must still produce a classifiable observation) and statement shape
// (tenant identifiers are parameters, with no name/email projection).

import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import {
  PARTIAL_OFFBOARDING_GRANT_REASON,
  classifyPartialOffboarding,
  type PartialOffboardingObservation,
} from '../application/use-cases/repair-partial-offboarding'
import { createPartialOffboardingLookup } from './partial-offboarding.lookup'

const ORG_ID = 'org-partial-offboarding-0001'
const USER_ID = 'user-partial-offboarding-0001'

/**
 * Flatten a drizzle SQL template into text + params (StringChunk vs raw params).
 *
 * Nested `SQL` nodes are recursed into rather than counted as a parameter.
 * `sql.raw(x)` produces exactly that shape — an `SQL` carrying a `StringChunk`
 * and no `value` of its own — so without this branch a raw interpolation of a
 * tenant identifier would be filed under `params` and the `text` guards below
 * would never see it.
 */
function sqlChunks(query: unknown): { text: string; params: unknown[] } {
  let text = ''
  const params: unknown[] = []
  const walk = (chunks: ReadonlyArray<unknown>): void => {
    for (const chunk of chunks) {
      if (chunk !== null && typeof chunk === 'object') {
        const candidate = chunk as { value?: unknown; queryChunks?: unknown }
        if (Array.isArray(candidate.queryChunks)) {
          walk(candidate.queryChunks)
          continue
        }
        if (Array.isArray(candidate.value)) {
          text += candidate.value.join('')
          continue
        }
        if (typeof candidate.value === 'string') {
          text += candidate.value
          continue
        }
      }
      params.push(chunk)
      text += '?'
    }
  }
  walk((query as { queryChunks?: ReadonlyArray<unknown> }).queryChunks ?? [])
  return { text, params }
}

const database = (snapshots: ReadonlyArray<ReadonlyArray<Record<string, unknown>>>) => {
  const execute = vi.fn()
  for (const rows of snapshots) execute.mockResolvedValueOnce({ rows })
  return { db: { execute } as unknown as Database, execute }
}

const observationRow = (overrides: Record<string, unknown> = {}) => ({
  member_id: 'member-partial-offboarding-01',
  active_grants: 0,
  offboarded_grants: 3,
  ...overrides,
})

describe('partial offboarding lookup — observe', () => {
  it('maps the crash signature into an observation the domain classifies as repairable', async () => {
    const fake = database([[observationRow()]])
    const lookup = createPartialOffboardingLookup(fake.db)

    const observation = await lookup.observe({
      organizationId: ORG_ID,
      userId: USER_ID,
    })

    expect(observation).toEqual({
      organizationId: ORG_ID,
      userId: USER_ID,
      memberId: 'member-partial-offboarding-01',
      activeGrantCount: 0,
      offboardedGrantCount: 3,
    } satisfies PartialOffboardingObservation)
    expect(classifyPartialOffboarding(observation)).toBe('partial_offboarding')
  })

  /**
   * A converged user has no membership row, so the correlated subquery yields
   * SQL NULL. That must arrive as `memberId: null` — the single input the
   * domain uses to decide the offboarding already completed.
   */
  it('reads an absent membership as a null member id, not an empty string', async () => {
    const fake = database([[observationRow({ member_id: null })]])
    const lookup = createPartialOffboardingLookup(fake.db)

    const observation = await lookup.observe({
      organizationId: ORG_ID,
      userId: USER_ID,
    })

    expect(observation.memberId).toBeNull()
    expect(classifyPartialOffboarding(observation)).toBe('already_offboarded')
  })

  it('treats a missing result row as a fully converged user rather than throwing', async () => {
    const fake = database([[]])
    const lookup = createPartialOffboardingLookup(fake.db)

    await expect(
      lookup.observe({ organizationId: ORG_ID, userId: USER_ID }),
    ).resolves.toEqual({
      organizationId: ORG_ID,
      userId: USER_ID,
      memberId: null,
      activeGrantCount: 0,
      offboardedGrantCount: 0,
    })
  })

  /**
   * The driver may hand back `COUNT(*)::int` as a string. Counts must stay
   * numeric because `classifyPartialOffboarding` gates on strict equality:
   * `activeGrantCount === 0` is false for the string `'0'` and false for `NaN`
   * alike, so a user who genuinely has no live grant would be classified
   * `not_offboarding` and the repairable state hidden from the operator.
   * (The `offboardedGrantCount > 0` half tolerates a string, since `>`
   * coerces numerically — strict equality is the load-bearing comparison.)
   */
  it('coerces driver-shaped counts to numbers and unusable ones to zero', async () => {
    const fake = database([
      [observationRow({ active_grants: '0', offboarded_grants: '2' })],
      [observationRow({ active_grants: 'not-a-number', offboarded_grants: null })],
    ])
    const lookup = createPartialOffboardingLookup(fake.db)

    await expect(
      lookup.observe({ organizationId: ORG_ID, userId: USER_ID }),
    ).resolves.toMatchObject({ activeGrantCount: 0, offboardedGrantCount: 2 })
    await expect(
      lookup.observe({ organizationId: ORG_ID, userId: USER_ID }),
    ).resolves.toMatchObject({ activeGrantCount: 0, offboardedGrantCount: 0 })
  })


  /**
   * The report is handed to an operator, so it must stay identifiers and
   * counts. A column the driver adds to the result set must not ride along.
   */
  it('projects only the content-free observation fields', async () => {
    const fake = database([
      [observationRow({ email: 'member@meridian.example', full_name: 'A Member' })],
    ])
    const lookup = createPartialOffboardingLookup(fake.db)

    const observation = await lookup.observe({
      organizationId: ORG_ID,
      userId: USER_ID,
    })

    expect(Object.keys(observation).sort()).toEqual([
      'activeGrantCount',
      'memberId',
      'offboardedGrantCount',
      'organizationId',
      'userId',
    ])
    const { text } = sqlChunks(fake.execute.mock.calls[0]?.[0])
    expect(text).not.toMatch(/email|name/i)
  })

  it('binds the tenant identifiers and the offboarding reason as parameters', async () => {
    const fake = database([[observationRow()]])
    const lookup = createPartialOffboardingLookup(fake.db)

    await lookup.observe({ organizationId: ORG_ID, userId: USER_ID })

    const { text, params } = sqlChunks(fake.execute.mock.calls[0]?.[0])
    expect(text).not.toContain(ORG_ID)
    expect(text).not.toContain(USER_ID)
    expect(params).toEqual([
      ORG_ID,
      USER_ID,
      ORG_ID,
      USER_ID,
      ORG_ID,
      USER_ID,
      PARTIAL_OFFBOARDING_GRANT_REASON,
    ])
  })
})

describe('partial offboarding lookup — listCandidates', () => {
  it('returns the bounded candidate pairs the sweep re-inspects', async () => {
    const fake = database([
      [
        { organization_id: 'org-a', user_id: 'user-a' },
        { organization_id: 'org-b', user_id: 'user-b' },
      ],
    ])
    const lookup = createPartialOffboardingLookup(fake.db)

    await expect(lookup.listCandidates({ limit: 25 })).resolves.toEqual([
      { organizationId: 'org-a', userId: 'user-a' },
      { organizationId: 'org-b', userId: 'user-b' },
    ])
  })

  it('returns no candidates when nothing matches the crash signature', async () => {
    const fake = database([[]])
    const lookup = createPartialOffboardingLookup(fake.db)

    await expect(lookup.listCandidates({ limit: 25 })).resolves.toEqual([])
  })

  /**
   * Repeated sweeps must walk the same page, so the caller-supplied bound and
   * the offboarding reason both have to reach the statement — an unbound scan
   * would let one sweep drag the whole revoked-grant table into Node.
   */
  it('binds the caller limit and the offboarding reason as parameters', async () => {
    const fake = database([[]])
    const lookup = createPartialOffboardingLookup(fake.db)

    await lookup.listCandidates({ limit: 7 })

    const { text, params } = sqlChunks(fake.execute.mock.calls[0]?.[0])
    expect(params).toEqual([PARTIAL_OFFBOARDING_GRANT_REASON, 7])
    expect(text).toContain('ORDER BY g.organization_id, g.user_id')
    expect(text).toContain('LIMIT')
  })
})
