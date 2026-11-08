import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import { seedGoalMonth } from '../testing/goal-running-month-seed'
import { createGoalProgramRepository } from './goal-program.repository'
import { scopeGoalProgramsForMember } from '../../application/use-cases/goal-program-visibility'
import { goalTargetProvenance } from '../../application/goal-target-provenance'
import type {
  GoalMonthlyResult,
  GoalProgramVersion,
  GoalSubjectAssignment,
} from '../../application/ports/goal-program.repository'

describe.sequential('Goal history pages (integration)', () => {
  let held: HeldTransaction | undefined

  beforeAll(async () => {
    clearEventSchemas()
    registerAllEventSchemas()
    held = await holdTransaction()
  })
  afterAll(async () => {
    await held?.rollBack()
    clearEventSchemas()
  })

  it('crosses same-month subject ties, preserving pinned history, latest revisions and Stop', async () => {
    if (!held) throw new Error('History fixture is unavailable')
    const { client, db } = held
    const org = `goal-history-${randomUUID()}`
    const property = randomUUID()
    const portals = [randomUUID(), randomUUID(), randomUUID()]
    await client.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, 'History', $1, now())`,
      [org],
    )
    await client.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone)
       VALUES ($1::uuid, $2, 'History', $1::text, 'UTC')`,
      [property, org],
    )
    for (const portal of portals) {
      await client.query(
        `INSERT INTO portals (id, organization_id, property_id, entity_type,
                              entity_id, name, slug, publication_state)
         VALUES ($1::uuid, $2, $3::uuid, 'property', $3::text,
           'Historical desk', $1::text, 'published')`,
        [portal, org, property],
      )
    }
    const first = await seedGoalMonth(client, {
      organizationId: org,
      propertyId: property,
      target: 10,
      subject: { kind: 'portal', portalId: portals[0]! },
    })
    const old = [first]
    for (const portal of portals.slice(1)) {
      old.push(
        await seedGoalMonth(client, {
          organizationId: org,
          propertyId: property,
          target: 10,
          subject: { kind: 'portal', portalId: portal },
          program: { programId: first.programId, versionId: first.versionId },
        }),
      )
    }
    const september = new Date('2026-09-01T00:00:00Z')
    const october = new Date('2026-10-01T00:00:00Z')
    await client.query(
      `UPDATE goal_monthly_results SET status = 'reconciling', updated_at = $2
       WHERE program_id = $1`,
      [first.programId, september],
    )
    await client.query(
      `UPDATE goal_monthly_results SET status = 'closed', evaluation_state = 'eligible',
         value = 12, sample_count = 12, achieved = true, reason = NULL,
         source_complete_through = $2, evaluation_watermark = $2,
         closed_at = $2, updated_at = $2 WHERE program_id = $1`,
      [first.programId, september],
    )
    const repository = createGoalProgramRepository(db)
    const original = await repository.getHistory(org, property, first.programId)
    if (!original) throw new Error('Original goal is unavailable')
    const version: GoalProgramVersion = {
      ...original.version,
      id: randomUUID(),
      version: 2,
      effectiveFrom: september,
      createdAt: september,
      createdBy: 'second-manager',
      changeReason: 'subjects_changed',
    }
    const assignments: GoalSubjectAssignment[] = portals.slice(0, 2).map((portal) => ({
      ...original.assignments[0]!,
      id: randomUUID(),
      programVersionId: version.id,
      subject: { kind: 'portal', portalId: portal },
      effectiveFrom: september,
      effectiveTo: null,
      createdAt: september,
      createdBy: 'second-manager',
    }))
    expect(
      await repository.revise({
        expectedVersion: original.version,
        version,
        assignments,
        supersedeRowlessHead: false,
        actorId: 'second-manager',
        at: september,
      }),
    ).toBe(true)
    const running: GoalMonthlyResult[] = assignments.map((assignment) => ({
      ...original.results[0]!,
      id: randomUUID(),
      assignmentId: assignment.id,
      programVersionId: version.id,
      periodStart: september,
      periodEnd: october,
      status: 'open',
      evaluation: {
        state: 'updating',
        value: null,
        sampleCount: 0,
        achieved: null,
        reason: 'period_open',
      },
      sourceCompleteThrough: null,
      evaluationWatermark: null,
      closedAt: null,
      createdAt: september,
      updatedAt: september,
    }))
    expect(
      await repository.appendResults({
        program: { ...original.program, currentVersion: 2 },
        version,
        results: running,
        at: september,
      }),
    ).toBe(2)
    const revisedResult = old[2]!.resultId
    let head = await repository.getClosedResult(org, property, revisedResult)
    if (!head) throw new Error('Closed month is unavailable')
    const lastRevision = randomUUID()
    for (const [id, value] of [
      [randomUUID(), 8],
      [lastRevision, 6],
    ] as const) {
      expect(
        await repository.appendResultRevision({
          head,
          revisionId: id,
          evaluation: {
            state: 'eligible',
            value,
            sampleCount: value,
            achieved: false,
            reason: null,
          },
          sourceCompleteThrough: september,
          evaluationWatermark: new Date('2026-09-03T00:00:00Z'),
          changeReason: 'late correction',
          createdBy: 'system',
          at: new Date('2026-09-03T00:00:00Z'),
        }),
      ).toMatchObject({ status: 'revised' })
      head = (await repository.getClosedResult(org, property, revisedResult))!
    }

    const nextVersion: GoalProgramVersion = {
      ...version,
      id: randomUUID(),
      version: 3,
      effectiveFrom: october,
      createdAt: new Date('2026-09-05T12:00:00Z'),
      createdBy: 'third-manager',
    }
    expect(
      await repository.revise({
        expectedVersion: version,
        version: nextVersion,
        assignments: [
          {
            ...assignments[0]!,
            id: randomUUID(),
            programVersionId: nextVersion.id,
            effectiveFrom: october,
          },
        ],
        supersedeRowlessHead: false,
        actorId: 'third-manager',
        at: new Date('2026-09-05T12:00:00Z'),
      }),
    ).toBe(true)
    const summary = await repository.getSummary(org, property, first.programId)
    if (!summary) throw new Error('Current summary is unavailable')
    expect(summary.version.id).toBe(nextVersion.id)
    expect(goalTargetProvenance(summary, summary.version)).toEqual({
      setAt: new Date('2026-08-01T00:00:00Z'),
      setBy: 'manager-1',
      countsFrom: new Date('2026-08-01T00:00:00Z'),
    })
    const [historicallyVisible] = scopeGoalProgramsForMember(
      await repository.listSummaries(org, property),
      [portals[2]!],
      [],
    )
    expect(historicallyVisible?.program.id).toBe(first.programId)
    expect(historicallyVisible?.assignments).toHaveLength(1)
    expect(historicallyVisible?.results).toMatchObject([
      {
        id: revisedResult,
        evaluation: { value: 6 },
      },
    ])

    const seen: GoalMonthlyResult[] = []
    let after: { periodStart: Date; id: string } | undefined
    do {
      const page = await repository.listHistory(org, property, first.programId, {
        limit: 2,
        after,
      })
      expect(page.results.length).toBeLessThanOrEqual(2)
      for (const result of page.results) {
        expect(page.versions.some((known) => known.id === result.programVersionId)).toBe(
          true,
        )
        expect(page.assignments.some((known) => known.id === result.assignmentId)).toBe(
          true,
        )
        expect(page.targetProvenance?.[result.programVersionId]?.setAt).toEqual(
          new Date('2026-08-01T00:00:00Z'),
        )
        expect(result.programVersionId).toBe(
          result.periodStart < september ? first.versionId : version.id,
        )
      }
      seen.push(...page.results)
      after = page.next ?? undefined
    } while (after)
    expect(seen.map((result) => result.id).sort()).toEqual(
      [...old.map((month) => month.resultId), ...running.map((month) => month.id)].sort(),
    )
    expect(seen.find((result) => result.id === revisedResult)).toMatchObject({
      evaluation: { value: 6, achieved: false },
      revision: { id: lastRevision, number: 2 },
    })
    expect(
      await repository.listHistory('another-organization', property, first.programId, {
        limit: 2,
      }),
    ).toEqual({
      results: [],
      versions: [],
      assignments: [],
      targetChanges: [],
      next: null,
    })

    expect(
      await repository.changeStatus({
        organizationId: org,
        propertyId: property,
        programId: first.programId,
        expectedStatus: 'active',
        status: 'ended',
        reason: null,
        actorId: 'second-manager',
        at: new Date('2026-09-10T12:00:00Z'),
      }),
    ).toMatchObject({ status: 'ended' })
    const ended = await repository.getHistory(org, property, first.programId)
    expect(ended?.version).toMatchObject({ id: nextVersion.id, effectiveTo: october })
    expect(ended?.results).toHaveLength(5)
    expect(
      ended?.assignments.find((assignment) => assignment.id === old[2]!.assignmentId),
    ).toMatchObject({
      subject: { kind: 'portal', portalId: portals[2] },
      effectiveTo: september,
    })
  })
})
